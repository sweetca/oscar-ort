const express = require('express');
const bodyParser = require('body-parser');
const cp = require('child-process-promise');
const util = require('util');
const fs = require('fs');
const schedule = require('node-schedule');
const request = require('request-promise-native');
const parseUrl = require('git-url-parse');
const convertData = require('./converter');
const replaceUrl = require('./replaceUrl');

const readFile = util.promisify(fs.readFile);
const readDir = util.promisify(fs.readdir);
const textParser = bodyParser.text();

const inProgress = {};
// 1 hour limit for log of subprocess
const timeLimit = 5 * 3600 * 1000;
let currentJob = {id: null};
let locked = false;

const config = require('./config/config').config;
const jobApi = require('./job/job');

function isGitRepo(url) {
    return url.endsWith('.git') || isGithubRepo(url) || isAndroidSourceRepo(url);
}

function isGithubRepo(url) {
    return /^https:\/\/.*github\.com\/[^/]+\/[^/]+\/{0,1}$/.test(url);
}

function isAndroidSourceRepo(url) {
    return url.startsWith('https://android.googlesource.com/');
}

function cleanGitUrl(url) {
    if (!isGitRepo(url)) {
        throw new Error(`Called with non git url: ${url}`);
    }
    return url;
}

function pickStdout({stdout}) {
    return stdout.trim();
}

function getTimer(process) {
    return setTimeout(() => {
            process.kill(9);
        },
        timeLimit
    );
}

const createHtmlReport = (tmpDir, scanId) => {
    return spawnLogged(
        'ort',
        [
            'report',
            '-i',
            `${tmpDir}/out/scan-result.json`,
            '-o',
            `${tmpDir}/out`,
            '-f',
            'WEBAPP',
        ],
        {
            cwd: tmpDir,
            capture: ['stdout', 'stderr'],
        },
        tmpDir,
        scanId
    );
};

function reporter(tmpDir, scanId) {
    return cp
        .exec('find out -type f', {cwd: tmpDir})
        .then(pickStdout)
        .then(() => createHtmlReport(tmpDir, scanId))
        .then(() => readFile(`${tmpDir}/out/scan-report-web-app.html`, 'utf8'))
        .then(file => sendHtml(file, scanId));
}

function sendHtml(file, id) {
    return request.post({
        url: `${API_URL}/report_upload/?id=${id}`,
        body: file,
    }).then(() => console.log('html report - success')).catch((e) => {
        console.log('html report - error');
        throw new Error(e);
    });
}

function sendScanResult(file, scanId) {
    return request.post({
        url: `${config.apiUrl}stack_scan/upload/?scanId=${scanId}`,
        json: {
            result: file,
            type: 'json',
        },
    }).then(() => console.log('send scan result - success')).catch((e) => {
        console.log('send scan result - error');
        throw new Error(e);
    });
}

function sendErrorResult(reason, scanId) {
    return request.post({
        url: `${config.apiUrl}stack_scan/uploadError/?scanId=${scanId}`,
        json: {
            error: reason,
        },
    })
        .then(() => console.log('send scan error - success'))
        .catch(() => console.log('send scan error - error'));
}

function cleanup(url) {
    finishJob();
    return () => {
        inProgress[url] = false;
    };
}

function writeLogs(process, tmpDir) {
    const logStream = fs.createWriteStream(`${tmpDir}/logger.txt`, {flags: 'a'});
    let timer = getTimer(process);

    process.stdout.on('data', (data) => {
        clearTimeout(timer);
        timer = getTimer(process);
        const logs = data.toString();
        if (logs.trim().length > 0) {
            if (logs.indexOf('INFO') === -1) {
                console.log('[spawn] stdout: ', logs);
            }
            logStream.write(logs);
        }
    });

    process.stderr.on('data', (data) => {
        clearTimeout(timer);
        timer = getTimer(process);
        if (data.toString().trim().length > 0) {
            console.log('[spawn] stderr: ', data.toString());
            logStream.write(`ERROR: ${data.toString()}`);
        }
    });

    return logStream;
}

const spawnLogged = (command, args, options, tmpDir, scanId) => {
    console.log(`starting command ${command} with args ${args.join(' ')}`);
    const spawned = cp.spawn(command, args, options);
    const {childProcess} = spawned;
    const logStream = writeLogs(childProcess, tmpDir);
    return new Promise((resolve, reject) => {
        spawned.then((res) => {
            console.log(`finished command ${command} with args ${args.join(' ')}`);
            logStream.close();
            resolve(res);
        }, (...params) => {
            console.log(`failed command ${command} with args ${args.join(' ')}`);
            logStream.close();
            sendLogs(tmpDir, scanId).then(() => cp.exec(`rm -rf ${tmpDir}`));
            reject(new Error(...params));
        }).catch((err) => {
            console.log(`failed command ${command} with args ${args.join(' ')}`);
            logStream.close();
            throw err;
        });
    });
};

const gitClone = (url, tmpDir, scanId) => {
    return spawnLogged(
        'git',
        [
            'clone',
            cleanGitUrl(url),
            'repo'
        ],
        {
            cwd: tmpDir,
            capture: ['stdout', 'stderr'],
        },
        tmpDir,
        scanId
    );
};

const analyzeDependencies = (tmpDir, scanId) => {
    return cp
        .exec(`find ${tmpDir} -name package.json`)
        .then(pickStdout)
        .then(output => output.split('\n'))
        .then(() => spawnLogged(
            'ort',
            [
                '--info',
                'analyze',
                '--allow-dynamic-versions',
                '-i',
                `${tmpDir}/repo`,
                '-o',
                `${tmpDir}/out`,
                '-f',
                'JSON',
            ],
            {
                cwd: tmpDir,
                capture: ['stdout', 'stderr'],
            },
            tmpDir,
            scanId,
        ));
};

const converter = (tmpDir, scanId) => {
    console.log(`converter : ${tmpDir} : ${scanId}`);
    if (fs.existsSync(`${tmpDir}/out/scan-result.json`)) {
        console.log(`file exist : ${tmpDir}/out/scan-result.json`);
    } else {
        throw new Error(`converter : file not exist : ${tmpDir}/out/scan-result.json`);
    }
    return readFile(`${tmpDir}/out/scan-result.json`, 'utf8')
        .then(file => convertData(JSON.parse(file)))
        .then(result => sendScanResult(result, scanId));
};

const changeUrl = (file, auth, revert = false) => {
    console.log(`changeUrl : ${file} : ${auth}`);
    return replaceUrl(`${file}`, auth, revert);
};

const depFilePromise = (tmpDir) => {
    return cp.exec('find out -type f', {cwd: tmpDir})
        .then(pickStdout)
        .then(f => f.split('\n')[0]);
};

const scanResultPromise = (tmpDir) => {
    return new Promise((resolve) => {
        if (fs.existsSync(`${tmpDir}/out/scan-result.json`)) {
            return resolve(`${tmpDir}/out/scan-result.json`);
        }
        throw new Error(`file ${tmpDir}/out/scan-result.json does not exist`);
    });
};

const checkAnalyzeResult = (tmpDir, scanId) => {
    console.log(`checkAnalyzeResult : ${tmpDir}/out/analyzer-result.json`);
    return readFile(`${tmpDir}/out/analyzer-result.json`, 'utf-8')
        .then((res) => {
            const data = JSON.parse(res);
            if (!data.analyzer.result.packages.length) {
                console.log(`No dependencies after analyzer : ${JSON.stringify(data.analyzer)}`);
                sendScanResult(convertData(data), scanId).then(() => cp.exec(`rm -rf ${tmpDir}`));
                throw new Error('No dependencies');
            }
        });
};

const scanDependencies = (tmpDir, scanId) => {
    console.log(`scanDependencies : ${tmpDir} : ${scanId}`);
    return spawnLogged(
        'ort',
        [
            '--info',
            'scan',
            '-c',
            '/ort-api/config.yml',
            '--ort-file',
            `${tmpDir}/out/analyzer-result.json`,
            '-o',
            `${tmpDir}/out`,
            '-f',
            'JSON',
        ],
        {
            cwd: tmpDir,
            capture: ['stdout', 'stderr'],
        },
        tmpDir,
        scanId,
    );
};

function sendLogs(tmpDir, id) {
    return readFile(`${tmpDir}/logger.txt`, 'utf8')
        .then(file => request.post({
            url: `${config.apiUrl}logs_upload/?id=${id}`,
            body: file,
        }).then(() => console.log('send logs - success'))
            .catch(() => console.log('send logs - error')));
}

const getUrlParams = (url) => {
    let newUrl = url;
    let parsedUrl;
    let auth;
    if (isGithubRepo(newUrl)) {
        if (!newUrl.endsWith('.git')) {
            newUrl = `${url}.git`;
        }
        parsedUrl = parseUrl(newUrl);
        auth = (parsedUrl.user === 'git' || !parsedUrl.user) ? '' : `${parsedUrl.protocol}://${parsedUrl.user}`;
        if (!auth && isGithubRepo(newUrl)) {
            newUrl = parsedUrl.toString('ssh');
        }
    }
    return {
        url: newUrl,
        auth,
    };
};

const checkEmptyFolder = (tmpDir, scanId) => {
    return readDir(`${tmpDir}/repo`)
        .then((result) => {
            if (!result.filter(item => item !== '.git').length) {
                sendScanResult([], scanId);
                throw new Error('Empty repository');
            }
        });
};

function analyzeGitRepo(url, scanId) {
    inProgress[url] = true;
    const urlParams = getUrlParams(url);

    return cp
        .exec('mktemp -d')
        .then(pickStdout)
        .then(
            (tmpDir) => {
                console.log('cloning ', cleanGitUrl(urlParams.url));
                return gitClone(cleanGitUrl(urlParams.url), tmpDir, scanId)
                    .then(() => checkEmptyFolder(tmpDir, scanId))
                    .then(() => analyzeDependencies(tmpDir, scanId))
                    .then(() => checkAnalyzeResult(tmpDir, scanId))
                    .then(() => changeUrl(`${tmpDir}/out/analyzer-result.json`, urlParams.auth))
                    .then(() => scanDependencies(tmpDir, scanId))
                    .then(() => changeUrl(`${tmpDir}/out/scan-result.json`, urlParams.auth, true))
                    .then(() => converter(tmpDir, scanId))
                    .then(() => reporter(tmpDir, scanId))
                    .then(() => sendLogs(tmpDir, scanId))
                    .then(() => console.log(`Scan finished : ${url} : ${scanId}`))
                    .then(() => Promise.all([depFilePromise(tmpDir), scanResultPromise(tmpDir)])
                        .then(([depFile, scanFile]) => Promise.all([readFile(`${tmpDir}/${depFile}`), readFile(`${scanFile}`)]))
                    )
                    .then((ret) => {
                        cp.exec(`rm -rf ${tmpDir}`);
                        return ret;
                    })
                    .catch((err) => {
                        sendLogs(tmpDir, scanId)
                            .then(() => {
                                cp.exec(`rm -rf ${tmpDir}`);
                            });
                        throw err;
                    });
            }
        )
        .then(([dependencies, licenses]) => {
            cleanup(url)();
            return {
                dependencies: [dependencies],
                licenses: [licenses],
                type: 'json',
            };
        })
        .catch((err) => {
            console.log(`error ${err.message}`);
            return sendErrorResult(err.toString(), scanId)
                .then(() => cleanup(url));
        });
}

const j = schedule.scheduleJob('*/1 * * * *', () => {
    if (locked === false) {
        console.log(`checking job : ${config.getJobUrl}`);
        const options = {
            url: config.getJobUrl,
            headers: {
                'Accept': 'application/json',
            },
        };
        request(options, (error, response, body) => {
            if (!error && response.statusCode === 200) {
                currentJob = JSON.parse(body);
                locked = true;
                console.log(`starting ort scan ${currentJob.payload.urlToScan}`);
                analyzeGitRepo(currentJob.payload.urlToScan, currentJob.payload.stackScanId);
            } else {
                console.log(`error job response ${response.statusCode} | ${error}`);
            }
        });
    }
});

const finishJob = () => {
    console.log(`try to finish job ${currentJob.id}`);
    jobApi.finish(currentJob.id).then((error, response) => {
        if (error) {
            console.log(error.toString());
            setTimeout(() => {
                finishJob();
            }, 1000);
        } else if (response.statusCode === 200) {
            currentJob = null;
            locked = false;
            console.log('Job finished');
        } else {
            console.log(response.toString());
            setTimeout(() => {
                finishJob();
            }, 1000);
        }
    }).catch(() => {
        console.log(response.toString());
        setTimeout(() => {
            finishJob();
        }, 1000);
    });

    const options = {
        url: `${config.finishJobUrl}${currentJob.id}`,
        method: 'PUT',
        headers: {
            Accept: 'application/json',
        },
    };
    return request(options, (error, response) => {

    });
};

const app = express();

app.use('*', (req, res, next) => {
    req.connection.setTimeout(0);
    next();
});

app.post('/url_in_progress', textParser, (req, res) => {
    const url = req.body;
    res.json({inProgress: inProgress[url]});
});

app.post('/url', textParser, (req, res, next) => {
    const url = req.body;
    if (isGitRepo(url)) {
        locked = true;
        analyzeGitRepo(url, req).then(output => res.json(output)).catch(next);
    } else {
        res.sendStatus(400);
    }
});

app.post('/url_async', textParser, (req, res, next) => {
    const url = req.body;
    const scanId = req.headers.scan_id;

    if (isGitRepo(url)) {
        locked = true;
        analyzeGitRepo(url, scanId, req).catch(next);
        return res.sendStatus(200);
    } else {
        return res.sendStatus(400);
    }
});

app.get('/current', (req, res) => {
    res.send(currentJob.id);
});

openApiSession().then((token) => {
    if (!token) {
        throw new Error('Error open session to API module');
    }
    app.listen(3000, () => {
        console.log('OSCAR-ORT started on port 3000');
    });
});


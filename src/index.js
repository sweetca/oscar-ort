const cp = require('child-process-promise');
const util = require('util');
const fs = require('fs');
const schedule = require('node-schedule');
const convertData = require('./converter');

const readFile = util.promisify(fs.readFile);
const readDir = util.promisify(fs.readdir);

const jobApi = require('./job/job').jobApi;

// 1 hour limit for log of subprocess
const timeLimit = 5 * 3600 * 1000;
let locked = false;

function pickStdout({stdout}) {
    return stdout.trim();
};

function getTimer(process) {
    return setTimeout(() => {
            process.kill(9);
        },
        timeLimit
    );
};

const createHtmlReport = (tmpDir, component, version) => {
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
        component,
        version
    );
};

function reporter(tmpDir, component, version) {
    return cp
        .exec('find out -type f', {cwd: tmpDir})
        .then(pickStdout)
        .then(() => createHtmlReport(tmpDir, component, version))
        .then(() => readFile(`${tmpDir}/out/scan-report-web-app.html`, 'utf8'))
        .then(file => sendHtml(file, component, version));
}

function sendHtml(file, component, version) {
    jobApi
        .uploadHtml(file, component, version)
        .then(() => console.log('html upload success'))
        .catch((e) => {
            console.log('html upload error');
            throw new Error(e);
        });
}

function sendLogs(tmpDir, component, version) {
    return readFile(`${tmpDir}/logger.txt`, 'utf8')
        .then(file =>
            jobApi.uploadLogs(file, component, version)
                .then(() => console.log('logs upload success'))
                .catch((err) => console.error('logs upload error', err)));
}

function sendScanResult(file, component, version) {
    return jobApi.uploadReport(file, component, version)
        .then(() => console.log('report upload success'))
        .catch((e) => {
            console.log('report upload error');
            throw new Error(e);
        });
}

function sendErrorResult(reason, component, version) {
    return jobApi.uploadError(reason, component, version)
        .then(() => console.log('scan error upload success'))
        .catch(() => console.log('scan error upload failed'));
}

function writeLogs(process, tmpDir) {
    let timer = getTimer(process);

    const logStream = fs.createWriteStream(`${tmpDir}/logger.txt`, {flags: 'a'});

    process.stdout.on('data', (data) => {
        console.log('log to file...');
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
        console.log('error to file...');
        clearTimeout(timer);
        timer = getTimer(process);
        if (data.toString().trim().length > 0) {
            console.log('[spawn] stderr: ', data.toString());
            logStream.write(`ERROR: ${data.toString()}`);
        }
    });

    return logStream;
};

const spawnLogged = (command, args, options, tmpDir) => {
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
            reject(new Error(...params));
        }).catch((err) => {
            console.log(`failed command ${command} with args ${args.join(' ')}`);
            logStream.close();
            throw err;
        });
    });
};

const clone = (path, tmpDir) => {
    console.log(`copy component sources ${path}`);
    return spawnLogged(
        'cp',
        [
            '-R',
            path,
            './repo',
        ],
        {
            cwd: tmpDir,
            capture: ['stdout', 'stderr'],
        },
        tmpDir
    );
};

const analyzeDependencies = (tmpDir, component, version) => {
    console.log(`analyzeDependencies : ${tmpDir}/repo`);
    return spawnLogged(
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
        component,
        version
    );
};

const converter = (tmpDir, component, version) => {
    console.log(`converter : ${tmpDir} : ${component} : ${version}`);
    if (fs.existsSync(`${tmpDir}/out/scan-result.json`)) {
        console.log(`file exist : ${tmpDir}/out/scan-result.json`);
    } else {
        throw new Error(`converter : file not exist : ${tmpDir}/out/scan-result.json`);
    }
    return readFile(`${tmpDir}/out/scan-result.json`, 'utf8')
        .then(file => convertData(JSON.parse(file)))
        .then(result => sendScanResult(result, component, version));
};

const checkAnalyzeResult = (tmpDir, component, version) => {
    console.log(`checkAnalyzeResult : ${tmpDir}/out/analyzer-result.json`);
    return readFile(`${tmpDir}/out/analyzer-result.json`, 'utf-8')
        .then((res) => {
            const data = JSON.parse(res);
            if (!data.analyzer.result.packages.length) {
                console.log(`No dependencies after analyzer : ${JSON.stringify(data.analyzer)}`);
                sendScanResult(convertData(data), component, version).then(() => cp.exec(`rm -rf ${tmpDir}`));
                throw new Error('No dependencies');
            }
        });
};

const scanDependencies = (tmpDir, component, version) => {
    console.log(`scanDependencies : dir ${tmpDir} : c ${component} : v ${version}`);
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
        component,
        version
    );
};

const checkEmptyFolder = (tmpDir) => {
    return readDir(`${tmpDir}/repo`)
        .then((result) => {
            if (!result.filter(item => item !== '.git').length) {
                throw new Error('Empty repository');
            }
        });
};

function analyzeComponent(job) {
    const component = job.payload.component;
    const version = job.payload.componentVersion;
    const path = job.payload.componentPath;

    console.log(`start scan component : ${component} : ${version} : ${path}`);

    return cp
        .exec('mktemp -d')
        .then(pickStdout)
        .then(
            (tmpDir) => {
                return clone(path, tmpDir)
                    .then(() => checkEmptyFolder(tmpDir))
                    .then(() => analyzeDependencies(tmpDir, component, version))
                    .then(() => checkAnalyzeResult(tmpDir, component, version))
                    .then(() => scanDependencies(tmpDir, component, version))
                    .then(() => converter(tmpDir, component, version))
                    .then(() => reporter(tmpDir, component, version))
                    .then(() => sendLogs(tmpDir, component, version))
                    .then(() => {
                        console.log(`scan finished : ${component} : ${version} : ${path}`);
                        cp.exec(`rm -rf ${tmpDir}`);
                    })
                    .catch((err) => {
                        sendLogs(tmpDir, component, version)
                            .then(() => {
                                cp.exec(`rm -rf ${tmpDir}`);
                                console.log('clean tmp dir after error');
                            });
                        throw err;
                    });
            }
        )
        .catch((err) => {
            console.error(`error when scan : ${component} : ${version} : ${path}`, err);
            return sendErrorResult(err.toString(), component, version)
                .then(() => finishJob(job))
                .catch(error => {
                    console.error(`error on sendErrorResult : ${component} : ${version} : ${path}`, error);
                });
        });
}

const finishJob = (job) => {
    console.log(`finishing job ${job.id}`);

    jobApi.finish(job.id)
        .then(() => {
            console.log(`Job finished ${job.id}`);
            locked = false;
        })
        .catch(error => {
            console.log(error);
            setTimeout(() => {
                finishJob(job);
            }, 1000);
        });
};

schedule.scheduleJob('*/1 * * * *', () => {
    if (locked === false) {
        jobApi.get().then(body => {
            const job = JSON.parse(body);
            console.log(`starting ort scan job ${job.id}`);
            locked = true;
            analyzeComponent(job);
        }).catch((error) => {
            console.log(`error job request ${error.message}`);
        });
    }
});
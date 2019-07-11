// Copyright (c) Codescoop Oy 2019. Licensed under the MIT license.
// SPDX-License-Identifier: MIT

const cp = require('child-process-promise');
const util = require('util');
const fs = require('fs');
const schedule = require('node-schedule');
const convert = require('./converter');

const readFile = util.promisify(fs.readFile);
const readDir = util.promisify(fs.readdir);

const jobApi = require('./job/job').jobApi;
const config = require('./config/config');

const pickStdout = ({stdout}) => {
    return stdout.trim();
};

const getOrt = () => {
    //return '/Users/alexskorohod/space/oss/oss-review-toolkit/cli/build/install/ort/bin/ort';
    return 'ort';
};

// 1 hour limit for log of subprocess
const timeLimit = 5 * 3600 * 1000;
const getTimer = process => {
    return setTimeout(() => {
            process.kill(9);
        },
        timeLimit
    );
};

const writeLogs = (process, tmpDir) => {
    let timer = getTimer(process);

    const logStream = fs.createWriteStream(`${tmpDir}/logger.txt`, {flags: 'a'});

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
};

const checkEmptyFolder = tmpDir => {
    return readDir(`${tmpDir}/repo`)
        .then((result) => {
            if (!result.filter(item => item !== '.git').length) {
                throw new Error('Empty repository');
            }
        });
};

const sendHtml = (file, component, version) => {
    jobApi
        .uploadHtml(file, component, version)
        .then(() => console.log('html upload success'))
        .catch((e) => {
            console.log('html upload error');
            throw new Error(e);
        });
};

const sendLogs = (tmpDir, component, version) => {
    return readFile(`${tmpDir}/logger.txt`, 'utf8')
        .then(file =>
            jobApi.uploadLogs(file, component, version)
                .then(() => console.log('logs upload success'))
                .catch((err) => console.error('logs upload error', err)));
};

const sendScanResult = (data, component, version) => {
    return jobApi.uploadReport(data, component, version)
        .then(() => console.log(`result upload success : ${component} : ${version}`))
        .catch((e) => {
            console.log(`result upload error : ${component} : ${version}`);
            throw new Error(e);
        });
};

const sendErrorResult = (reason, component, version) => {
    return jobApi.uploadError(reason, component, version)
        .then(() => console.log('scan error upload success'))
        .catch(() => console.log('scan error upload failed'));
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

const convertAnalyser = (tmpDir, component, version) => {
    console.log(`convertAnalyser : ${tmpDir} : ${component} : ${version}`);
    if (fs.existsSync(`${tmpDir}/out/analyzer-result.json`)) {
        console.log(`file exist : ${tmpDir}/out/analyzer-result.json`);
    } else {
        throw new Error(`convertAnalyser: file not exist : ${tmpDir}/out/analyzer-result.json`);
    }
    const file = fs.readFileSync(`${tmpDir}/out/analyzer-result.json`, 'utf8');
    return convert
        .convertAnalyser(JSON.parse(file))
        .then(result => sendScanResult(result, component, version))
        .catch(err => {throw new Error(err)});
};

const convertScan = (tmpDir, component, version) => {
    console.log(`convertScan : ${tmpDir} : ${component} : ${version}`);
    if (fs.existsSync(`${tmpDir}/out/scan-result.json`)) {
        console.log(`file exist : ${tmpDir}/out/scan-result.json`);
    } else {
        throw new Error(`convertScan : file not exist : ${tmpDir}/out/scan-result.json`);
    }
    const file = fs.readFileSync(`${tmpDir}/out/scan-result.json`, 'utf8');
    return convert
        .convertScan(JSON.parse(file))
        .then(result => sendScanResult(result, component, version))
        .catch(err => {throw new Error(err)});
};

const finishJob = (job) => {
    console.log(`finishing job ${job.id}`);

    jobApi.finish(job.id)
        .then(() => {
            console.log(`Job finished ${job.id}`);
            locked = false;
        })
        .catch(() => {
            console.log('error finish job API');
            setTimeout(() => {
                finishJob(job);
            }, 1000);
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

const createHtmlReport = (tmpDir, component, version) => {
    return spawnLogged(
        getOrt(),
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

const reporter = (tmpDir, component, version) => {
    return createHtmlReport(tmpDir, component, version)
        .then(() => readFile(`${tmpDir}/out/scan-report-web-app.html`, 'utf8'))
        .then(file => sendHtml(file, component, version));
};

const analyzer = (tmpDir, component, version) => {
    console.log(`analyzeDependencies : ${tmpDir}/repo`);
    return spawnLogged(
        getOrt(),
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

const scanner = (tmpDir, component, version) => {
    console.log(`scanDependencies : dir ${tmpDir} : c ${component} : v ${version}`);
    return spawnLogged(
        getOrt(),
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

const analyzeComponent = job => {
    const component = job.payload.component;
    const version = job.payload.componentVersion;
    const path = job.payload.componentPath;

    console.log(`start analyze component : ${component} : ${version} : ${path}`);

    return cp
        .exec('mktemp -d')
        .then(pickStdout)
        .then(
            (tmpDir) => {
                return clone(path, tmpDir)
                    .then(() => checkEmptyFolder(tmpDir))
                    .then(() => analyzer(tmpDir, component, version))
                    .then(() => convertAnalyser(tmpDir, component, version))
                    .then(() => {
                        cp.exec(`rm -rf ${tmpDir}`);
                        console.log(`scan finished : ${component} : ${version} : ${path}`);
                        finishJob(job);
                    })
                    .catch((err) => {
                        cp.exec(`rm -rf ${tmpDir}`);
                        console.log('clean tmp dir after error');
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
};

const scanComponent = job => {
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
                    .then(() => analyzer(tmpDir, component, version))
                    .then(() => convertAnalyser(tmpDir, component, version))
                    .then(() => scanner(tmpDir, component, version))
                    .then(() => convertScan(tmpDir, component, version))
                    .then(() => reporter(tmpDir, component, version))
                    .then(() => {
                        cp.exec(`rm -rf ${tmpDir}`);
                        console.log(`scan finished : ${component} : ${version} : ${path}`);
                        finishJob(job);
                    })
                    .catch((err) => {
                        cp.exec(`rm -rf ${tmpDir}`);
                        console.log('clean tmp dir after error');
                        throw err;
                    });
            }
        )
        .catch((err) => {
            console.error(`error when scan : ${component} : ${version} : ${path}`, err);
            return sendErrorResult(err.toString(), component, version)
                .then(() => finishJob(job))
                .catch(() => {
                    console.error(`error on sendErrorResult : ${component} : ${version} : ${path}`);
                });
        });
};

let locked = false;
const iteration = () => {
    if (locked === false) {
        jobApi.get().then(body => {
            const job = JSON.parse(body);
            console.log(`starting ort scan job ${job.id}`);
            locked = true;
            if (config.mode === 'analyze') {
                return analyzeComponent(job);
            } else {
                return scanComponent(job);
            }
        }).catch((error) => {
            console.log(`error job request ${error.message}`);
        });
    }
};

schedule.scheduleJob('*/1 * * * *', iteration);
iteration();
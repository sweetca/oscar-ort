// Copyright (c) Codescoop Oy 2019. Licensed under the MIT license.
// SPDX-License-Identifier: MIT

const profileConst = require('./profile.json');

const {PROFILE, MODE} = process.env;

const profileString = PROFILE || 'local';
console.log(`Install profile for oscar-ort : ${profileString}`);

let config = profileConst[profileString];

if (MODE && MODE === 'analyze') {
    config.mode = 'analyze';
} else {
    config.mode = 'scan';
}
console.log(`Install mode for oscar-ort : ${config.mode}`);

config.getJobUrl = `${config.job}/find_job/${config.jobType[config.mode]}/oscar-ort-1`;

config.getFinishJob = (jobId) => {
    return `${config.job}/finish_job/${jobId}/oscar-ort-1`;
};
config.getUploadReport = (component, version) => {
    return `${config.job}/ort/report/${component}/${version}`;
};
config.getUploadHtml = (component, version) => {
    return `${config.job}/ort/html/${component}/${version}`;
};
config.getUploadLogs = (component, version) => {
    return `${config.job}/ort/logs/${component}/${version}`;
};
config.getUploadError = (component, version) => {
    return `${config.job}/ort/error/${component}/${version}`;
};

exports.config = config;
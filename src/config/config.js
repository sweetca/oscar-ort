// Copyright (c) Codescoop Oy 2019. Licensed under the MIT license.
// SPDX-License-Identifier: MIT

const profileConst = require('./profile.json');

const {PROFILE} = process.env;

const profileString = PROFILE || 'local';
console.log(`Install profile for oscar-ort : ${profileString}`);

let config = profileConst[profileString];

config.getJobUrl = `${config.job}/find_job/${config.jobType}/oscar-ort-1`;

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

exports.config = config;
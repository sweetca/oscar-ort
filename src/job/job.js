// Copyright (c) Codescoop Oy 2019. Licensed under the MIT license.
// SPDX-License-Identifier: MIT

const request = require('request-promise');
const config = require('../config/config').config;

const jobApi = {
    get: () => {
        const options = {
            method: 'GET',
            uri: config.getJobUrl,
            headers: {
                'Accept': 'application/json'
            }
        };
        return request(options);
    },
    finish: (jobId) => {
        const options = {
            method: 'PUT',
            uri: config.getFinishJob(jobId),
            headers: {
                'Accept': 'application/json'
            }
        };
        return request(options);
    },
    uploadHtml: (file, component, version) => {
        if (!file) {
            file = 'Html empty!';
        }
        const options = {
            method: 'POST',
            uri: config.getUploadHtml(component, version),
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'text/plain'
            },
            body: file
        };
        return request(options);
    },
    uploadLogs: (file, component, version) => {
        if (!file) {
            file = 'Logs empty!';
        }
        const options = {
            method: 'POST',
            uri: config.getUploadLogs(component, version),
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'text/plain'
            },
            body: file
        };
        return request(options);
    },
    uploadReport: (file, component, version) => {
        const options = {
            method: 'POST',
            uri: config.getUploadReport(component, version),
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            json: {
                result: file,
                type: 'json',
            }
        };
        return request(options);
    },
    uploadError: (reason, component, version) => {
        const options = {
            method: 'POST',
            uri: config.getUploadReport(component, version),
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            json: {
                error: reason
            }
        };
        return request(options);
    }
};

exports.jobApi = jobApi;
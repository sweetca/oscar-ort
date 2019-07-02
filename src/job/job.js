// Copyright (c) Codescoop Oy 2019. Licensed under the MIT license.
// SPDX-License-Identifier: MIT

const request = require('request-promise');
const config = require('../config/config').config;

const jobApi = {
    get: async () => {
        const options = {
            method: "GET",
            uri: config.getJobUrl,
            headers: {
                'Accept': 'application/json'
            }
        };
        return await request(options);
    },
    finish: async (jobId) => {
        const options = {
            method: "GET",
            uri: `${config.finishJobUrl}${jobId}`,
            headers: {
                'Accept': 'application/json'
            }
        };
        return await request(options);
    }
};

exports.jobApi = jobApi;
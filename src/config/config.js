// Copyright (c) Codescoop Oy 2019. Licensed under the MIT license.
// SPDX-License-Identifier: MIT

const profileConst = require('./profile.json');

const {PROFILE, MONGO_LOGIN, MONGO_PASS, OSCAR_DIR} = process.env;

const profileString = PROFILE || 'local';
console.log(`Install profile for ort : ${profileString}`);

let config = profileConst[profileString];
config.mongoUrl = config.mongo.replace('{LOGIN}', MONGO_LOGIN).replace('{PASS}', MONGO_PASS);
config.getJobUrl = `${config.job}find_job?type=${config.jobType}`;
config.finishJobUrl = `${config.job}finish_job/`;
config.apiUrl = `${config.job}`;
config.repositoryDir = OSCAR_DIR ? OSCAR_DIR : config.repositoryDir;

exports.config = config;
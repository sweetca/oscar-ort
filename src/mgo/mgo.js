// Copyright (c) Codescoop Oy 2019. Licensed under the MIT license.
// SPDX-License-Identifier: MIT

const config = require('../config/config').config;
const mgo = require('mongodb');
const MongoClient = mgo.MongoClient;
const licenseDocCollection = 'gitLicenseScan';
const gitRepoCollection = 'gitRepo';
const jobCollection = 'job';

let db = null;
const client = new MongoClient(config.mongoUrl);
client.connect((err) => {
    if (err) {
        console.error('mgo connect', err);
        return;
    }
    db = client.db(config.db);
});

const mgoApi = {
    lockLicenseScan: async (id) => {
        const o_id = new mgo.ObjectID(id);
        const set = {$set: {'status': 'charged'}};
        const collection = db.collection(licenseDocCollection);
        return await collection.updateOne({ '_id' : o_id }, set);
    },
    getLicenseScan: async (id) => {
        const o_id = new mgo.ObjectID(id);
        const collection = db.collection(licenseDocCollection);
        return await collection.find({'_id': o_id}).toArray();
    },
    updateLicenseScan: async (id, apiResponse, status, error) => {
        const o_id = new mgo.ObjectID(id);
        const set = {$set: {
                'apiResponse': apiResponse,
                'status': status,
                'error': error,
                'parsed': new Date()}};
        return await db.collection(licenseDocCollection).updateOne({ '_id' : o_id }, set);
    },
    updateMainLicense: async (repoId, scan) => {
        const mainLicenses = scan['main-license'];
        let license = 'No main license';
        if (mainLicenses && mainLicenses.nomos && mainLicenses.nomos.length > 0) {
            for (let i = 0; i < mainLicenses.nomos.length; i++) {
                license = mainLicenses.nomos[i];
                if (!license.startsWith('No')) {
                    break;
                }
            } 
        }
        const o_id = new mgo.ObjectID(repoId);
        const set = {$set: {'license': license}};
        return await db.collection(gitRepoCollection).updateOne({ '_id' : o_id }, set);
    },
    finishJob: async (jobId) => {
        const o_id = new mgo.ObjectID(jobId);
        const set = {$set: {'finished': true, 'update': new Date()}};
        return await db.collection(jobCollection).updateOne({ '_id' : o_id }, set);
    }
};

exports.mgoApi = mgoApi;
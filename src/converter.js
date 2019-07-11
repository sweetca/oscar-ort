// Copyright (c) Codescoop Oy 2019. Licensed under the MIT license.
// SPDX-License-Identifier: MIT

const cleanType = (vcs) => {
    if (vcs.url.indexOf('github') > -1) {
        return 'github';
    } else if (vcs.url.indexOf('gitlab') > -1) {
        return 'gitlab';
    } else {
        return vcs.type.toLowerCase();
    }
};

const cleanUrl = (url) => {
    return url
        .replace('ssh://', '')
        .replace('https://', '')
        .replace('http://', '')
        .replace('git://', '')
        .replace('git@', '')
        .replace(':', '/')
        .replace('.git', '');
};

const readProject = item => {
    const project = {
        name: item.id,
        purl: item.purl,
        file: item.definition_file_path,
        homepage: item.homepage_url,
        licenses: ['MIT'],
        dependencies: []
    };

    if (item.declared_licenses_processed && item.declared_licenses_processed.spdx_expression) {
        project.licenses = [item.declared_licenses_processed.spdx_expression];
    }
    if (item.vcs_processed && item.vcs_processed.url) {
        project.vcs = {
            type: cleanType(item.vcs_processed),
            url: cleanUrl(item.vcs_processed.url),
            revision: item.vcs_processed.revision
        };
    }
    if (item.scopes) {
        item.scopes.forEach(scope => {
            const scopeName = scope.name;
            const depTree = parseScopeDepList(scope.dependencies, scopeName);
            project.dependencies.push(...depTree);
        })
    }

    return project;
};

const readPkg = item => {
    const pkg = {
        name: item.id,
        purl: item.purl,
        description: item.description,
        homepage: item.homepage_url,
        licenses: ['MIT'],
        source: ''
    };

    if (item.declared_licenses_processed && item.declared_licenses_processed.spdx_expression) {
        pkg.licenses = [item.declared_licenses_processed.spdx_expression];
    }
    if (item.source_artifact && item.source_artifact.url) {
        pkg.source = item.source_artifact.url;
    }
    if (item.vcs_processed && item.vcs_processed.url) {
        pkg.vcs = {
            type: cleanType(item.vcs_processed),
            url: cleanUrl(item.vcs_processed.url),
            revision: item.vcs_processed.revision
        };
    }

    return pkg;
};

const readScan = item => {
    const scan = {
        name: item.id
    };

    if (item.results && item.results.length > 0) {
        const firstresult = item.results[0];
        if (firstresult.provenance) {
            if (firstresult.provenance.original_vcs_info) {
                scan.url = firstresult.provenance.original_vcs_info.url;
            } else if (firstresult.provenance.source_artifact) {
                scan.url = firstresult.provenance.source_artifact.url;
            }
        }
        if (firstresult.summary) {
            const from = Date.parse(firstresult.summary.start_time);
            const till = Date.parse(firstresult.summary.end_time);
            scan.fileCount = firstresult.summary.file_count;
            scan.timeScan = till - from;
            if (firstresult.summary.license_findings && firstresult.summary.license_findings.license_findings.length > 0) {
                scan.licenses = firstresult.summary.license_findings.map(l => l.license);
            }
        }

    }

    return scan;
};

const parseScopeDep = (dep, scopeName) => {
    const result = {
        name: dep.id,
        scope: scopeName,
        dependencies: []
    };
    if (dep.dependencies && dep.dependencies.length > 0) {
        result.dependencies = parseScopeDepList(dep.dependencies, scopeName);
    }
    return result;
};

const parseScopeDepList = (depTreeList, scopeName) => {
    const result = [];
    depTreeList.forEach(dep => {
        result.push(parseScopeDep(dep, scopeName));
    });
    return result;
};

const convertAnalyser = (data) => {
    console.log('start convertAnalyser');
    return new Promise((resolve, reject) => {
        if (!data) {
            throw new Error('Data after analyzer empty!');
        }
        let analyzer = data.analyzer ? data.analyzer : null;
        if (analyzer && analyzer.result) {
            analyzer = analyzer.result;
        } else {
            console.log(data);
            throw new Error('No result data after analyzer!');
        }

        let projects = [];
        if (analyzer.projects && analyzer.projects.length > 0) {
            projects = analyzer.projects.map(prj => readProject(prj));
        }

        let packages = [];
        if (analyzer.packages && analyzer.packages.length > 0) {
            packages = analyzer.packages.map(item => readPkg(item.package));
        } else {
            console.log('analyzer does not detect packages!');
        }

        console.log('end convertAnalyser');
        resolve({projects, packages});
    });
};

const convertScan = (data) => {
    console.log('start convertScan');
    return new Promise((resolve, reject) => {
        convertAnalyser(data)
            .then(result => {
                if (data.scanner && data.scanner.results && data.scanner.results.scan_results) {
                    result.scans = data.scanner.results.scan_results.map(item => readScan(item));
                }
                console.log('end convertScan');
                resolve(result);
            }).catch(e => {throw new Error(e);});
    });
};

module.exports = {convertScan, convertAnalyser};

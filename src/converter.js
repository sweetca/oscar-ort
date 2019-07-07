const path = require('path');

const convertData = (data) => {
    const scanResults = data.scanner ? {} : null;
    if (scanResults) {
        data.scanner.results.scan_results.forEach((item) => {
            scanResults[item.id] = item;
        });
    }
    return convertProjects(data.analyzer.result.projects, scanResults);
};

const convertProjects = (projects, scanResults) => {
    return projects.map(project => ({
        path: path.dirname(`./${project.definition_file_path}`),
        name: project.id,
        purl: project.purl,
        licenses: project.declared_licenses,
        packages: scanResults ? convertProject(project, scanResults) : [],
    }));
};

const convertProject = (project, scanResults) => {
    const obj = {};
    const convertPackage = (pack, parent, scope) => {
        if (obj[pack.id]) {
            if (parent && obj[pack.id].parents.indexOf(parent) === -1) {
                obj[pack.id].parents.push(parent);
            }
            if (obj[pack.id].scopes.indexOf(scope) === -1) {
                obj[pack.id].scopes.push(scope);
            }
        } else if (parent) {
            obj[pack.id] = {
                parents: [parent],
                purl: scanResults[pack.purl],
                licenses: scanResults[pack.id] &&
                scanResults[pack.id].results[0].summary.license_findings.map(license => license.license),
                scopes: [scope],
            };
        } else {
            obj[pack.id] = {
                parents: [],
                purl: scanResults[pack.purl],
                licenses: scanResults[pack.id] &&
                scanResults[pack.id].results[0].summary.license_findings.map(license => license.license),
                scopes: [scope],
            };
        }

        if (pack.dependencies && pack.dependencies.length) {
            pack.dependencies.forEach((dep) => {
                convertPackage(dep, pack.id, scope);
            });
        }
    };

    project.scopes.forEach((scope) => {
        scope.dependencies.forEach(item => convertPackage(item, null, scope.name));
    });

    return Object.keys(obj).map(key =>
        ({
            name: key,
            purl: obj[key].purl,
            parents: obj[key].parents,
            licenses: obj[key].licenses,
            scopes: obj[key].scopes,
        })
    );
};

module.exports = convertData;

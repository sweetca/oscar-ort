const replace = require('replace-in-file');

const changeUrl = (file, auth, revert) => {
  if (auth) {
    if (revert) {
      return replace({
        files: file,
        from: new RegExp(`"url" : "${auth}@github.com/`, 'g'),
        to: '"url" : "https://github.com/',
      });
    }
    return replace({
      files: file,
      from: new RegExp('"url" : "https://github.com/|"url" : "ssh://git@github.com/|"url" : "git@github.com:|"url" : "http://github.com/|"url" : "git://github.com/', 'g'),
      to: `"url" : "${auth}@github.com/`,
    });
  } else if (!revert) {
    return replace({
      files: file,
      from: [new RegExp('"url" : "https://github.com/|"url" : "http://github.com/', 'g'), new RegExp('[+]https://github.com', 'g')],
      to: ['"url" : "git@github.com:', '+ssh://git@github.com'],
    });
  }
};

module.exports = changeUrl;

'use strict';
// One ordered preference list for the page, Chrome preferences and HTTP.
function languages(fp = {}) {
  const values = Array.isArray(fp.languages) && fp.languages.length ? fp.languages : [fp.language || 'en-US'];
  return [...new Set(values)].slice(0, 10);
}
function acceptLanguage(fp) {
  return languages(fp).map((value, index) => index ? value + ';q=' + (1 - index / 10).toFixed(1) : value).join(',');
}
module.exports = {languages, acceptLanguage};

/* Parser-blocking presentation bootstrap. Shared by first paint and runtime. */
(function () {
  'use strict';
  var root = document.documentElement;
  function parse(value) {
    try {
      var saved = JSON.parse(value);
      return saved &&
        saved.version === 1 &&
        (saved.preference === 'dark' ||
          saved.preference === 'light' ||
          saved.preference === 'system')
        ? saved.preference
        : 'dark';
    } catch {
      return 'dark';
    }
  }
  function key(scope) {
    return 'it-inventory:theme:v1:' + scope;
  }
  function resolve(preference) {
    return preference === 'system'
      ? typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark'
      : preference;
  }
  function read(scope) {
    try {
      return parse(window.localStorage.getItem(key(scope)));
    } catch {
      return 'dark';
    }
  }
  function apply(preference) {
    var theme = resolve(preference);
    root.dataset.theme = theme;
    root.dataset.themePreference = preference;
    root.style.colorScheme = theme;
    return theme;
  }
  window.inventoryTheme = {
    parse: parse,
    key: key,
    resolve: resolve,
    read: read,
    apply: apply,
  };
  apply(read(root.dataset.themeScope || 'anonymous'));
})();

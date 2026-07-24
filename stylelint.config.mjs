export default {
  extends: ["stylelint-config-standard"],
  rules: {
    "declaration-no-important": true,
    "selector-max-universal": 0,
    "selector-pseudo-class-no-unknown": [
      true,
      {
        "ignorePseudoClasses": ["has"]
      }
    ]
  }
};

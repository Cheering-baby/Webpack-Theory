// const { SyncBailHook } = require("tapable");
const { add } = require("./common");

var test1 = 1;
var test2 = 2;
var test3 = add(test1, test2);
console.log(test3);

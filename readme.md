# carbonite-cli

A simple carbonite compiler cli run entirely in node (slow but works)

## Install
* `npm install carbonite-cli`

## Usage
* Single file `carbonite compile <platform> <input file> <ouput file>`
* Pipeline `carbonite pipe <pipeline> [variables]`

## Examples
* `carbonite compile javascript.source main.carb bin/out.js`
* `carbonite pipe Project/php.pipeline myVar=123`

## Links
* [Github](https://github.com/Echorial/carbonite-cli)
* [npm](https://www.npmjs.com/package/carbonite-cli)
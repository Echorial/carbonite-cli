#!/usr/bin/env node
const fs = require("fs");
const program = require('commander');
const Carbonite = require('carbonite');
const path = require("path");

const registryFile = "registry.json";

let localRegistry = null;

let localPath = process.env.HOMEPATH + "/carbonPackages"; // TODO: Fix

function includeLib(c) {
	c.addNativeLibrary();
}

function findProject(dir) {
	if (fs.existsSync(dir + "/Project")) {
		return dir + "/Project";
	}
}

function loadLocalRegistry() {
	if (!localRegistry) {
		if (!fs.existsSync(localPath))
			fs.mkdirSync(localPath);

		if (!fs.existsSync(localPath + "/" + registryFile))
			fs.writeFileSync(localPath + "/" + registryFile, "{}");

		localRegistry = JSON.parse(fs.readFileSync(localPath + "/" + registryFile, "utf8"));
	}
}

function saveLocalRegistry() {
	if (!fs.existsSync(localPath))
		fs.mkdirSync(localPath);

	fs.writeFileSync(localPath + "/" + registryFile, JSON.stringify(localRegistry || {}, null, "\t"));
}

function importPackage(name, version, callback) {
	loadLocalRegistry();

	if (localRegistry[name]) {
		callback(null, localRegistry[name].entry);
	}else{
		callback("Unkown package '" + name + "'");
	}
}

program
	.version('1.0.2')
	.command('compile <platform> <file> <location>')
	.description('Compile')
	.action(function (platform, file, location) { // Non pipeline compiler
		let start = Date.now();
		let c = new Carbonite.Compiler();
		c.importHandler = importPackage;

		// Include native library(string, int, bool, standards)
		includeLib(c);

		// Include file passed to cli
		let source = c.addSource(file, fs.readFileSync(file, "utf8"));
		source.file = file;
		source.process();

		// Build and assemble into raw ouput
		c.build(platform, {});
		if (!c.status.hadError)
			fs.writeFileSync(location, c.rawOutput);

		console.log("Built in " + (Date.now() - start) + " ms");
		console.log(c.status.stringify());
	});

program.command("register")
	.description("Links this package to the local system registry")
	.action(function () {
		loadLocalRegistry();
		let dir = process.cwd();
		let prj = findProject(dir);

		if (!prj) {
			console.log("No /Project directory found.");
		}

		if (fs.existsSync(prj + "/package.json")) {
			let pack;

			try {
				pack = JSON.parse(fs.readFileSync(prj + "/package.json"));
			}catch (e) {
				console.log("Error while parsing Project/package.json. " + e);
				return;
			}

			if (!pack.name) {
				console.log("Package name required in Project/package.json");
				return;
			}

			if (!pack.entry) {
				console.log("Package entry path required in Project/package.json");
				return;
			}
			
			localRegistry[pack.name] = {location: dir, entry: dir + "/" + pack.entry};

			saveLocalRegistry();

			console.log("Linked " + pack.name);
		}else{
			console.log("No Project/package.json found.");
		}
	});

program.command('pipe <pipeline> [args]')
	.option("--link <header>")
	.description('Build from a pipeline')
	.action(function (pipeline, args, opt) { // Pipeline parser
		let start = Date.now();
		let c = new Carbonite.Compiler();
		c.importHandler = importPackage;

		includeLib(c);

		if (opt.link) {
			let headRaw = JSON.parse(fs.readFileSync(opt.link, "utf8"));
			c.loadHeader(headRaw);
		}

		let regex = /([a-zA-Z0-9_.]*)\s*=\s*([^ ]*)/g;
		let m;

		if (args)
		while ((m = regex.exec(args)) !== null) {
			if (m.index == regex.lastIndex)
				regex.lastIndex++;

			try {
				c.pipeReference[m[1]] = JSON.parse(m[2]);
			}catch(e) {
				c.pipeReference[m[1]] = m[2];
			}
		}

		let file = pipeline;
		let source = c.addSource(file, fs.readFileSync(file, "utf8"));
		source.pipeline = true;
		source.file = file;
		source.process();

		let project = path.dirname(pipeline);

		if (c.pipeConfig.autoCache) {
			let cache = {};
			if (!fs.existsSync(project + "/tmp"))
				fs.mkdirSync(project + "/tmp");
			
			if (fs.existsSync(project + "/tmp/cache.json"))
				cache = JSON.parse(fs.readFileSync(project + "/tmp/cache.json"));

			c.autoCache = true;
			if (c.loadCache)
				c.loadCache(cache);
		}

		if (c.pipeConfig.useOldTemplates) {
			c.useOldTemplates = true;
		}

		let enPath = path.resolve(pipeline, "../../" + c.pipeConfig.entry);

		let entry = c.addSource(enPath, fs.readFileSync(enPath, "utf8"));
		entry.file = enPath;
		entry.process();

		c.build(c.pipeConfig.platform + ".memory", c.pipeConfig);

		if (!c.status.hadError) {
			let concat = "";

			if (c.pipeConfig.type === "app") {
				if (c.pipeConfig.platform == "cpp.source")
					concat = `int main(int argc, char *argv[]) {\n	App app;\n	return app.start(std::vector<std::string>(argv + 1, argv + argc));\n}`;
				else
					concat = "App.start();";
			}else if (c.pipeConfig.type == "package")
				if (c.pipeConfig["javascript.module"])
					concat = "module.exports = " + c.pipeConfig["javascript.module"] + ";";
			let output = c.pipeConfig.output || "./carbonOutputFile";
			if (output[0] == "~") {
				output = path.resolve(pipeline, "../../" + output.substr(1));
			}

			if (c.pipeConfig.platform == "documentation.dynamic") {
				if (!fs.existsSync(output))
					fs.mkdirSync(output);
				fs.writeFileSync(output + "/index.html", "<!DOCTYPE html><html><head><script src='core.js'></script><link href='https://fonts.googleapis.com/icon?family=Material+Icons' rel='stylesheet'><link rel='stylesheet' href='theme.css'></link></head><body><script src='data.js'></script></body></html>");

				let docDir = path.resolve(path.dirname(require.resolve("carbonite")) + "/../src/doc/dynamic/") + "/";
				fs.writeFileSync(output + "/core.js", fs.readFileSync(docDir + "core.js"));
				fs.writeFileSync(output + "/theme.css", fs.readFileSync(docDir + "/themes/material.css"));

				fs.writeFileSync(output + "/data.js", c.rawOutput);
			}else
				fs.writeFileSync(output, c.rawOutput + concat);
		}

		if (c.autoCache) {
			let caches = [];
			
			for (let i in c.sourceCaches) {
				caches.push(c.sourceCaches[i].serialize());
			}
			fs.writeFileSync(project + "/tmp/cache.json", "[" + caches.join(", ") + "]");
		}
		
		console.log("Built in " + (Date.now() - start) + " ms " + (c.autoCache ? "\x1b[32mautoCached\x1b[0m" : ""));
		console.log(c.status.stringify());
	});

program.parse(process.argv);
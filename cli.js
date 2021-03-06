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
	}else if (path.basename(dir).toLowerCase() == "project") {
		return dir;
	}else{
		let up = fs.realpathSync(path.join(dir, ".."));

		if (fs.realpathSync("/") == up)
			return false;
		else
			return findProject(up);
	}
}

function getPackageInfo(dir) {
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
		
		return {package: pack, location: prj};
	}else{
		return {package: false, location: prj};
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
		callback("Unknown package '" + name + "'");
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

		// Build and assemble into raw output
		c.build(platform, {});
		if (!c.status.hadError)
			fs.writeFileSync(location, c.rawOutput);

		console.log("Built in " + (Date.now() - start) + " ms");
		console.log(c.status.stringify());
	});

program
	.command("info")
	.description("Displays info about the current project")
	.action(function () {
		let dir = process.cwd();
		let data = getPackageInfo(dir);

		if (data && data.package) {
			let pack = data.package;

			console.log("");
			console.log("\x1b[34m" + pack.name);
			console.log("");
			console.log("\x1b[0m" + JSON.stringify(pack, null, "	"));
		}else if (data.location) {
			console.log("No Project/package.json found.");
		}
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
	.option("--no-cache", "Disabled autoCaching")
	.description('Build from a pipeline')
	.action(function (pipeline, args, opt) { // Pipeline parser
		let start = Date.now();
		let c = new Carbonite.Compiler();
		c.importHandler = importPackage;
		
		includeLib(c);

		noCache = opt.cache;

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
		let rootDir;

		if (!fs.existsSync(file)) {
			let dir = process.cwd();
			let data = getPackageInfo(dir);

			if (!data) {
				console.log("Unable to find pipeline " + file);
				return;
			}else{
				let splits = file.split(".");

				if (splits[splits.length - 1] == "pipeline") {
					file = data.location + "/" + file;
				}else{
					file = data.location + "/" + file + ".pipeline";
				}

				rootDir = path.resolve(data.location, "../");

				if (!fs.existsSync(file)) {
					console.log("Unable to find pipeline " + file);
					return;
				}
			}
		}

		let source = c.addSource(file, fs.readFileSync(file, "utf8"));
		source.pipeline = true;
		source.file = file;
		source.process();

		let project;
		if (rootDir)
			project = rootDir + "/Project";
		else
			project = path.dirname(pipeline);

		if (c.pipeConfig.autoCache && noCache) {
			let cache = {};
			if (!fs.existsSync(project + "/tmp"))
				fs.mkdirSync(project + "/tmp");
			
			if (fs.existsSync(project + "/tmp/cache.json"))
				try {
					cache = JSON.parse(fs.readFileSync(project + "/tmp/cache.json"));
				} catch (e) {
					cache = {};
				}

			c.autoCache = true;
			if (c.loadCache)
				c.loadCache(cache);
		}

		if (c.pipeConfig.useOldTemplates) {
			c.useOldTemplates = true;
		}

		if (c.pipeConfig.asyncAwait) {
			c.asyncAwait = true;
		}

		let enPath;

		if (!rootDir)
			enPath = path.resolve(pipeline, "../../" + c.pipeConfig.entry);
		else
			enPath = path.resolve(rootDir, "./" + c.pipeConfig.entry);

		let entry = c.addSource(enPath, fs.readFileSync(enPath, "utf8"));
		entry.file = enPath;
		entry.process();

		c.build(c.pipeConfig.platform + ".memory", c.pipeConfig);

		if (!c.status.hadError) {
			let concat = "";

			if (c.pipeConfig.type === "app") {
				if (c.pipeConfig.platform == "cpp.source")
					concat = `int main(int argc, char *argv[]) {\n	App app;\n	return app.start(std::unique_ptr<std::vector<std::string>>(new std::vector<std::string>(argv + 1, argv + argc))).value_or(0);\n}`;
				else
					concat = "carbonApp = new App();\ncarbonApp.start([]);";
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
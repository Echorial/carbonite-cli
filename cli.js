#!/usr/bin/env node
const fs = require("fs");
const program = require('commander');
const Carbonite = require('./bin/carbonite.js');
const path = require("path");

function includeLib(c) {
	let base = path.resolve(__dirname, "./library/library.carb");
	let native = c.addSource("Native", fs.readFileSync(base, "utf8"));
	native.file = base;
	native.process();
}

program
	.version('0.0.1')
	.command('compile <platform> <file> <location>')
	.description('Compile')
	.action(function (platform, file, location) { // Non pipeline compiler
		let start = Date.now();
		let c = new Carbonite.Compiler();

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

	program.command('pipe <pipeline> [args]')
	.option("--link <header>")
	.description('Build from a pipeline')
	.action(function (pipeline, args, opt) { // Pipeline parser
		let start = Date.now();
		let c = new Carbonite.Compiler();

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
				fs.mkdir(project + "/tmp");
			
			if (fs.existsSync(project + "/tmp/cache.json"))
				cache = JSON.parse(fs.readFileSync(project + "/tmp/cache.json"));

			c.autoCache = true;
			if (c.loadCache)
				c.loadCache(cache);
		}

		let enPath = path.resolve(pipeline, "../../" + c.pipeConfig.entry);

		let entry = c.addSource(enPath, fs.readFileSync(enPath, "utf8"));
		entry.file = enPath;
		entry.process();

		c.build(c.pipeConfig.platform + ".memory", c.pipeConfig);

		if (!c.status.hadError) {
			let concat = "";

			if (c.pipeConfig.type === "app")
				concat = "App.start();";
			else if (c.pipeConfig.type == "package")
				if (c.pipeConfig["javascript.module"])
					concat = "module.exports = " + c.pipeConfig["javascript.module"] + ";";
			let output = c.pipeConfig.output || "./carbonOutputFile";
			if (output[0] == "~") {
				output = path.resolve(pipeline, "../../" + output.substr(1));
			}

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
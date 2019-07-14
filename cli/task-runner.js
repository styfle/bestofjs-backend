const { createLogger, format, transports } = require("winston");
// const pino = require('pino')
const mongoose = require("mongoose");
require("dotenv").config();

const fs = require("fs-extra");
const path = require("path");
const prettyBytes = require("pretty-bytes");
const prettyMs = require("pretty-ms");

const models = require("../core/models");
const createClient = require("../core/github/github-api-client");
const { createStarStorage } = require("../core/star-storage/star-storage");

const { parseCommandLineOptions } = require("./utils");
const processProjects = require("./process-projects");
const processHeroes = require("./process-heroes");

async function runTasks(tasks) {
  tasks = Array.isArray(tasks) ? tasks : [tasks];
  const options = parseCommandLineOptions();
  const runner = createTaskRunner(options);
  const logger = runner.getContext().logger;

  await runner.start();
  let index = 1;
  const t0 = new Date();

  try {
    for (const { name, handler } of tasks) {
      logger.info(
        `TASK ${index} of ${tasks.length}: "${name}" ${
          options.readonly ? " [READONLY mode]" : ""
        }`
      );
      await runTask({ name, handler });
      index = index + 1;
    }
  } catch (error) {
    console.error(error); // eslint-disable-line
    logger.error("Unexpected error", { error: error.message });
  } finally {
    await runner.finish();
    logger.info("THE END", { duration: getDuration(t0) });
  }

  async function runTask({ name, handler }) {
    const t0 = new Date();
    await runner.run(handler);

    logger.info(`End of "${name}"`, { duration: getDuration(t0) });
  }
}

function createTask(name, handler) {
  if (typeof name !== "string")
    throw new Error("A name should the first argument of `createTask`");
  if (typeof handler !== "function") {
    throw new Error(`The task handler should be a function`);
  }
  return { name, handler };
}

function createTaskRunner(options = {}) {
  let { dbEnv = "v2", logLevel, readonly, limit } = options;
  if (!logLevel) {
    logLevel = limit === 1 ? "debug" : "verbose";
  }

  const logger = createLogger({
    level: logLevel,
    format: format.combine(
      format.colorize(),
      // format.splat(),
      format.simple()
      // format.prettyPrint()
      // format.json()
    ),
    transports: [new transports.Console()]
  });

  const getGitHubClient = () => {
    const accessToken = process.env.GITHUB_ACCESS_TOKEN;
    const client = createClient(accessToken);
    return client;
  };

  const context = {
    logger,
    models,
    readonly
  };

  const saveJSON = async (json, fileName) => {
    logger.info(`Saving ${fileName}`, {
      size: prettyBytes(JSON.stringify(json).length)
    });
    const filePath = path.join(process.cwd(), "build", fileName);
    await fs.outputJson(filePath, json); // does not return anything
    logger.info("JSON file saved!", { fileName, filePath });
  };

  const start = async () => {
    const mongo_key = "MONGO_URI_" + dbEnv.toUpperCase();
    const mongo_uri = process.env[mongo_key];
    if (!mongo_uri)
      throw new Error(`"${mongo_key}" env. variable is not defined.`);
    logger.info("Connecting to", {
      uri: mongo_uri.replace(/(mongodb:\/\/)(.+):(.+)(@.+)/, "$1***@***$4")
    });
    await mongoose.connect(mongo_uri, { useNewUrlParser: true });
    logger.info("Connected to the database");
  };

  const finish = () => {
    mongoose.disconnect();
    logger.info("Database disconnected");
  };

  return {
    getContext() {
      return context;
    },

    start,
    finish,

    run: async task => {
      if (typeof task !== "function")
        throw new Error("Task runner needs a function!");
      // try {
      // await start();
      const starCollection = models.Snapshot.collection;
      const starStorage = createStarStorage(starCollection);

      await task({
        logger,
        models,
        starStorage,
        readonly,
        // inject the `context` in `processProjects` provided to the customer
        processProjects: params =>
          processProjects({ ...params, context, options }),
        processHeroes: params => processHeroes({ ...params, context, options }),
        getGitHubClient,
        saveJSON
      });
      // } catch (error) {
      //   console.error(error); // eslint-disable-line
      //   logger.error("Unexpected error", { error: error.message });
      // } finally {
      //   finish();
      // }
    }
  };
}

function getDuration(t0) {
  const duration = new Date() - t0;
  return prettyMs(duration);
}

module.exports = {
  createTask,
  createTaskRunner,
  runTasks
};
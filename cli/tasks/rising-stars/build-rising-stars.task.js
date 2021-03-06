const { flatten, orderBy, uniqBy } = require("lodash");

const { createTask } = require("../../task-runner");

const tags = [
  "angular",
  "auto",
  "build",
  "compiler",
  "css-in-js",
  "framework",
  "graphql",
  "ide",
  "learning",
  "react",
  "react-native",
  "mobile",
  "nodejs-framework",
  "ssg",
  "test-framework",
  "test",
  "vue"
];

module.exports = createTask("build-rising-stars", async context => {
  const { processProjects, saveJSON, starStorage, logger } = context;
  const { data: projects } = await processProjects({
    handler: readProject({ starStorage }),
    query: { deprecated: false, disabled: false },
    sort: { createdAt: 1 }
  });

  const sortedProjects = orderBy(projects, "delta", "desc");
  const result = filterProjects(sortedProjects);

  logger.info(`${result.length} projects included in Rising Stars`);

  await saveJSON(
    { date: new Date(), count: result.length, projects: result },
    "rising-stars.json"
  );
});

const readProject = ({ starStorage }) => async project => {
  const { trends, timeSeries } = await starStorage.computeAllTrends(
    project._id,
    { referenceDate: new Date("2020-01-01T10:10:00.000Z") }
  );

  const monthly = timeSeries.monthly.reverse().map(({ delta }) => delta);

  const data = {
    name: project.name,
    full_name: project.github.full_name,
    description: project.getDescription(),
    stars: project.github.stargazers_count,
    delta: trends.yearly,
    monthly,
    tags: project.tags.map(tag => tag.code),
    owner_id: project.github.owner_id,
    created_at: project.github.created_at
  };

  const url = project.getURL();
  if (url) {
    data.url = url;
  }

  if (project.icon && project.icon.url) {
    data.icon = project.icon.url;
  }

  return {
    data,
    meta: {
      success: true
    }
  };
};

function filterProjects(projects) {
  const candidates = projects
    .filter(item => !!item) // remove empty items generated by errors (when projects have no snapshots)
    .filter(({ delta }) => !!delta && delta > 500);
  const overallLeaders = candidates.slice(0, 50);
  const leadersByCategory = tags.map(getTopProjectsByCategory(candidates));
  const allLeaders = [...overallLeaders, ...flatten(leadersByCategory)];
  const result = uniqBy(allLeaders, "full_name");
  return result;
}

const getTopProjectsByCategory = projects => tagName => {
  return projects
    .filter(({ tags }) => {
      return tags.includes(tagName);
    })
    .slice(0, 20);
};

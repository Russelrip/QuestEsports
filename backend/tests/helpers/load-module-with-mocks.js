const path = require("path");

const clearModule = (modulePath, visited = new Set()) => {
  const resolvedPath = require.resolve(modulePath);
  if (visited.has(resolvedPath)) {
    return;
  }

  visited.add(resolvedPath);
  const cachedModule = require.cache[resolvedPath];
  if (!cachedModule) {
    return;
  }

  for (const child of cachedModule.children) {
    clearModule(child.id, visited);
  }

  delete require.cache[resolvedPath];
};

const loadModuleWithMocks = (modulePath, mocks) => {
  const resolvedModulePath = require.resolve(modulePath);
  const restorers = [];

  clearModule(resolvedModulePath);

  for (const [dependencyPath, mockExports] of Object.entries(mocks)) {
    const resolvedDependencyPath = require.resolve(dependencyPath);
    const previous = require.cache[resolvedDependencyPath];

    require.cache[resolvedDependencyPath] = {
      id: resolvedDependencyPath,
      filename: resolvedDependencyPath,
      loaded: true,
      exports: mockExports,
      children: [],
      paths: [],
      path: path.dirname(resolvedDependencyPath),
    };

    restorers.push(() => {
      if (previous) {
        require.cache[resolvedDependencyPath] = previous;
      } else {
        delete require.cache[resolvedDependencyPath];
      }
    });
  }

  const loadedModule = require(resolvedModulePath);

  return {
    module: loadedModule,
    restore: () => {
      clearModule(resolvedModulePath);
      while (restorers.length > 0) {
        const restore = restorers.pop();
        restore();
      }
    },
  };
};

module.exports = {
  loadModuleWithMocks,
};

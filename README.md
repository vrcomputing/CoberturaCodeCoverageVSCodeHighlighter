# Cobertura Code Coverage Highlighter

Cobertura code coverage highlighter parsing [OpenCppCoverage](https://github.com/OpenCppCoverage/OpenCppCoverage) generated cobertura XML files and highlighting hit and missed lines in the C++ source files.

![doc/extension.png](doc/extension.png)

# Commands

|Title|Command|Description|
|-|-|-|
|CCC: Select a report for coverage analysis|coberturahighlighter.selectReport|Select a report file based on configuration `coberturahighlighter.reportPattern`. Afterwards use the `CCC: Show Coverage` or `CCC: Hide Coverage` commands to show or hide the coverage of contained source files.|
|CCC: Show Coverage|coberturahighlighter.showCoverage|Shows hit and missed lines in the C++ source files.|
|CCC: Hide Coverage|coberturahighlighter.hideCoverage|Hides hit and missed lines in the C++ source files.|

# Configurations

```json
"coberturahighlighter.hitColor": {
    "type": "string",
    "default": "#4CAF5080",
    "description": "Color for covered rows",
    "format": "color"
},
"coberturahighlighter.missColor": {
    "type": "string",
    "default": "#F4433680",
    "description": "Color for uncovered rows",
    "format": "color"
},
"coberturahighlighter.reportPattern": {
    "type": "string",
    "default": "*.cobertura",
    "description": "Glob pattern for cobertura report filenames"
},
"coberturahighlighter.minCoverage": {
    "type": "integer",
    "default": 80,
    "description": "Minimum line coverage in percent"
}
```
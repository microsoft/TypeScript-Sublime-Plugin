TypeScript Plugin for Sublime Text
==================================

[![Join the chat at https://gitter.im/Microsoft/TypeScript-Sublime-Plugin](https://badges.gitter.im/Join%20Chat.svg)](https://gitter.im/Microsoft/TypeScript-Sublime-Plugin?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge)

The plugin uses an IO wrapper around the TypeScript language services to provide an enhanced Sublime Text experience when working with TypeScript code.

Requirements
--------------

The plug-in uses **Node.js** to run the TypeScript server.  The plug-in looks for node in the PATH environment variable (which is inherited from Sublime).  If the 'node\_path' setting is present, this will override the PATH environment variable and the plug-in will use the value of the 'node\_path' setting as the node executable to run.  See more information in the tips.

Note: Using different versions of TypeScript
--------------
This plugin can be configured to load an alternate version of TypeScript.
This is typically useful for trying out nightly builds, or prototyping with custom builds.
To do that, update the `Settings - User` file with the following:

```json
"typescript_tsdk": "<path to your folder>/node_modules/typescript/lib"
```

Installation
------------
If using [Package Control](https://packagecontrol.io/) for Sublime Text, simply install the `TypeScript` package.

Alternatively, you can clone the repo directly into your Sublime plugin folder.  For example, for Sublime Text 3 on a Mac this would look something like:
```
cd ~/"Library/Application Support/Sublime Text 3/Packages"
git clone --depth 1 https://github.com/Microsoft/TypeScript-Sublime-Plugin.git TypeScript
```
And on Windows:
```
cd "%APPDATA%\Sublime Text 3\Packages"
git clone --depth 1 https://github.com/Microsoft/TypeScript-Sublime-Plugin.git TypeScript
```
(`--depth 1` downloads only the current version to reduce the clone size.)
Note if you are using the portable version of Sublime Text, the location will be different.  (See http://docs.sublimetext.info/en/latest/basic_concepts.html#the-data-directory for more info).

**IMPORTANT** If you already have a package called `TypeScript` installed, either remove this first, or clone this repo to a different folder, else module name resolution can break the plugin.

Platform support
----------------
#### OS:
The plugin has identical behavior across Windows, Mac, and Linux;

#### Sublime Text version:
The plugin supports both ST2 and ST3. However, some features are only available in ST3:
+ Tool tips
+ Error list

On Windows with ST2, you may see a "plugin delay" message upon startup.  This happens because ST2 does not call "plugin_loaded()", so the TypeScript server process is started from within an event handler.

Where possible, the use of a [Sublime Text 3](http://www.sublimetext.com/3) build >= 3070 is recommended, as this provides a popup API used for tool tips.

Features
--------
The below features are available via the keyboard shortcuts shown, or via the Command Palette (^ means the `ctrl` key):

|Feature                | Shortcut        |
|-----------------------|-----------------|
|Rename                 | `^T` `^M`       |
|Find references        | `^T` `^R`       |
|Next reference         | `^T` `^N`       |
|Prev reference         | `^T` `^P`       |
|Format document        | `^T` `^F`       |
|Format selection       | `^T` `^F`       |
|Format line            | `^;`            |
|Format braces          | `^ Shift ]`     |
|Navigate to symbol     | `^ Alt R`       |
|Go to definition       | `^T^D` or `F12` |
|Trigger completion     | `^Space`        |
|Trigger signature help | `Alt+,`         |
|See previous signature in the tooltip | `Alt + up`   |
|See next signature in the tooltip | `Alt + down` |
|Paste and format       | `^V` or <code>&#8984;V</code> |
|Quick info             | `^T` `^Q`       |
|Build		        | (Win)`^B` or `F7`, (OSX) `⌘B` or `F7`   |
|Error list             | (via Command Palette) |

The "format on key" feature is on by default, which formats the current line after typing `;`, `}` or `enter`.
To disable it, go to `Preferences` -> `Package Settings` -> `TypeScript` -> `Plugin Settings - User`, and add
`"typescript_auto_format": false` to the json file.

For further information about the keyboard shortcuts, please refer to the [`Default.sublime-keymap`](https://github.com/Microsoft/TypeScript-Sublime-Plugin/blob/master/Default.sublime-keymap) file for common shortcuts and
[`Default (OSX).sublime-keymap`](https://github.com/Microsoft/TypeScript-Sublime-Plugin/blob/master/Default%20(OSX).sublime-keymap),
[`Default (Windows).sublime-keymap`](https://github.com/Microsoft/TypeScript-Sublime-Plugin/blob/master/Default%20(Windows).sublime-keymap),
[`Default (Linux).sublime-keymap`](https://github.com/Microsoft/TypeScript-Sublime-Plugin/blob/master/Default%20(Linux).sublime-keymap)
for OS-specific shortcuts.

Project System
------
The plugin supports two kinds of projects:

#### Inferred project

For loose TS files opened in Sublime, the plugin will create an inferred project and include every files that the current file refers to.

#### Configured project

The plugin also supports representing a TypeScript project via a [tsconfig.json](http://www.typescriptlang.org/docs/handbook/tsconfig-json.html) file. If a file of this name is detected in a parent directory, then its settings will be used by the plugin.

Screenshots
------
- Project error list

![](https://raw.githubusercontent.com/Microsoft/TypeScript-Sublime-Plugin/master/screenshots/errorlist.gif)

- Signature popup (Requires [Sublime Text 3](http://www.sublimetext.com/3) build >= 3070)

![](https://raw.githubusercontent.com/Microsoft/TypeScript-Sublime-Plugin/master/screenshots/signature.gif)

- Navigate to symbol

![](https://raw.githubusercontent.com/Microsoft/TypeScript-Sublime-Plugin/master/screenshots/navigateToSymbol.gif)

- Format

![](https://raw.githubusercontent.com/Microsoft/TypeScript-Sublime-Plugin/master/screenshots/format.gif)

- Rename

![](https://raw.githubusercontent.com/Microsoft/TypeScript-Sublime-Plugin/master/screenshots/build_tsconfig.gif)

- Find all references

![](https://raw.githubusercontent.com/Microsoft/TypeScript-Sublime-Plugin/master/screenshots/find_ref.gif)

- Quick info

![](https://raw.githubusercontent.com/Microsoft/TypeScript-Sublime-Plugin/master/screenshots/quickinfo.gif)

- Build configured project

![](https://raw.githubusercontent.com/Microsoft/TypeScript-Sublime-Plugin/master/screenshots/build_tsconfig.gif)

- Build loose file

![](https://raw.githubusercontent.com/Microsoft/TypeScript-Sublime-Plugin/master/screenshots/build_loose_file.gif)

Reporting Issues
-------
Issues are being tracked via the [GitHub Issues](https://github.com/Microsoft/TypeScript-Sublime-Plugin/issues) page for the project, and tagged with the appropriate issue type. Please do log issues for any bugs you find or enhancements you would like to see (after searching to see if such as issue already exists).  We are excited to get your feedback and work with the community to make this plugin as awesome as possible.

Note about `.tmLanguage` related issues
--------------
As the TypeScript and TypeScriptReact `.tmLanguage` definition files are shared across multiple editors including Sublime Text, Atom-TypeScript, and Visual Studio Code, we decided to create a dedicated repo for these files to combine the efforts for improvement.
The new repo is at https://github.com/Microsoft/TypeScript-TmLanguage, and all future tmLanguage-related issues will be tracked there and ported back to this repo.

Tips and Known Issues
----
See tips and known issues in the [wiki page](https://github.com/Microsoft/TypeScript-Sublime-Plugin/wiki/Tips-and-Known-Issues).


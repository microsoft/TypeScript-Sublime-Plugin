TypeScript Plugin for Sublime Text
==================================

The plugin uses an IO wrapper around the TypeScript language services to provide
an enhanced Sublime Text experience when working with TypeScript code.

Installation
------------
If using [Package Control](https://packagecontrol.io/) for Sublime Text, simply 
install the `TODO` package.  

Alternatively, you can clone the repo directly into
your Sublime plugin folder.  For example, for Sublime Text 3 on a Mac this would 
look something like:

```
cd ~/"Library/Application Support/Sublime Text 3/Packages"
git clone https://github.com/Microsoft/TypeScript-Sublime-Plugin.git
```

Platform support
----------------
The plugin has identical behavior across Windows, Mac, and Linux platforms. 
Where possible, the use of a [Sublime Text 3](http://www.sublimetext.com/3) 
build >= 3070 is recommended, as this provides a popup API used for tool tips.

Features
--------
The below features are available via the keyboard shortcuts shown, or via the 
Command Pallete:

|Feature           | Shorcut       |
|------------------|---------------|
|Rename            | ^T ^M         |
|Find references   | ^T ^R         |
|Next reference    | ^T ^N         |
|Prev reference    | ^T ^P         |
|Format document   | ^T ^F         |
|Format selection  | ^T ^F         |
|Format line       | ^ ;           |
|Format braces     | ^ Shift + ]   |
|Save tmp          | ^T ^S         |
|Go to definition  | ^T ^D (or F12)|
|Paste and format  | (^ or Super) V|
|Quick info        | ^T ^Q         |
|Rename            | ^T ^M         |

The plugin supports representing a TypeScript project via a 
[tsconfig.json](https://github.com/Microsoft/TypeScript/pull/1692) file. If a 
file of this name is detected in a parent directory, then its settings will be 
used by the plugin.

Issues
------
The plugin is current an Alpha, and as such there are many enhancements to 
implement, and many bugs to be fixed.  These are being tracked via the 
[GitHub Issues](https://github.com/Microsoft/TypeScript-Sublime-Plugin/issues) 
page for the project, and tagged with the appropriate issue type.

Please do log issues for any bugs you find or enhancements you would like to see 
(after searching to see if such as issue already exists).  We are excited to 
get your feedback and work with the community to make this plugin as awesome as 
possible.

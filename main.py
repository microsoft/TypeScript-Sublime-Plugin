import sys
import os
import subprocess

if sys.version_info < (3, 0):
    from typescript.libs import *
    from typescript.libs.reference import *
    from typescript.libs.view_helpers import *
    from typescript.listeners import *
    from typescript.commands import *
else:
    from .typescript.libs import *
    from .typescript.libs.reference import *
    from .typescript.libs.view_helpers import *
    from .typescript.listeners import *
    from .typescript.commands import *

# Enable Python Tools for visual studio remote debugging
try:
    from ptvsd import enable_attach

    enable_attach(secret=None)
except ImportError:
    pass


def _cleanup_011():
    """Remove any old zipped package installed by 0.1.1 release"""
    this_file = os.path.abspath(__file__)

    # Is the current file running under installed packages or packages?
    offset = this_file.find(os.path.sep + 'Installed Packages' + os.path.sep)
    if offset == -1:
        offset = this_file.find(os.path.sep + 'Packages' + os.path.sep)

    if offset == -1:
        print('ERROR: Could not location parent packages folder')
        return

    # Move/delete old package if present
    old_package = os.path.join(this_file[:offset], 'Installed Packages', 'TypeScript.sublime-package')
    temp_name = os.path.join(this_file[:offset], 'Installed Packages', 'TypeScript.-old-sublime-package')
    if os.path.exists(old_package):
        # Rename first, in case delete fails due to file in use
        print('Detected outdated TypeScript plugin package. Removing ' + old_package)
        os.rename(old_package, temp_name)
        os.remove(temp_name)

try:
    _cleanup_011()
except:
    pass

logger.log.warn('TypeScript plugin initialized.')


def plugin_loaded():
    """
    Note: this is not always called on startup by Sublime, so we call it
    from on_activated or on_close if necessary.
    """
    log.debug("plugin_loaded started")
    cli.initialize()
    ref_view = get_ref_view(False)
    if ref_view:
        settings = ref_view.settings()
        ref_info_view = settings.get('refinfo')
        if ref_info_view:
            print("got refinfo from settings")
            ref_info = build_ref_info(ref_info_view)
            cli.update_ref_info(ref_info)
            ref_view.set_scratch(True)
            highlight_ids(ref_view, ref_info.get_ref_id())
            cur_line = ref_info.get_ref_line()
            if cur_line:
                update_ref_line(ref_info, int(cur_line), ref_view)
            else:
                print("no current ref line")
        else:
            window = sublime.active_window()
            if window:
                window.focus_view(ref_view)
                window.run_command('close')
    else:
        print("ref view not found")
    log.debug("plugin_loaded ended")
    _check_typescript_version()


def plugin_unloaded():
    """
    Note: this unload is not always called on exit
    """
    print('typescript plugin unloaded')
    ref_view = get_ref_view()
    if ref_view:
        ref_info = cli.get_ref_info()
        if ref_info:
            ref_view.settings().set('refinfo', ref_info.as_value())
    cli.service.exit()


_UPDATE_TS_MESSAGE = "Warning from TypeScript Sublime Text plugin:\n\n\
Detected command-line TypeScript compiler version '{0}'. The TypeScript \
Sublime Text plugin is using compiler version '{1}'. There may be \
differences in behavior between releases.\n\n\
To update your command-line TypeScript compiler to the latest release, run \
'npm update -g typescript'."

def _check_typescript_version():
    """
    Notify user to upgrade npm typescript. Do this only once every time the
    plugin is updated.
    """
    settings = sublime.load_settings('Preferences.sublime-settings')
    cached_plugin_version = settings.get("typescript_plugin_tsc_version")

    try:
        plugin_tsc_version = _get_plugin_tsc_version()

        if cached_plugin_version != plugin_tsc_version:
            # The version number getting from the tsc command is different to
            # the version number stored in the setting file. This means user
            # has just updated the plugin.

            npm_tsc_version = _get_npm_tsc_version()

            if npm_tsc_version != plugin_tsc_version:
                sublime.message_dialog(_UPDATE_TS_MESSAGE.format(
                    npm_tsc_version, plugin_tsc_version))

                # Update the version in setting file so we don't show this
                # message twice.
                settings.set("typescript_plugin_tsc_version", plugin_tsc_version)
                sublime.save_settings("Preferences.sublime-settings")

    except Exception as error:
        log.error(error)

def _get_plugin_tsc_version():
    cmd = [get_node_path(), TSC_PATH, "-v"]
    return _execute_cmd_and_parse_version_from_output(cmd)

def _is_executable(path):
    return os.path.isfile(path) and os.access(path, os.X_OK)

def _get_npm_tsc_version():
    if os.name != 'nt' and _is_executable("/usr/local/bin/tsc"): # Default location on MacOS
        cmd = [get_node_path(), "/usr/local/bin/tsc", "-v"]
    else:
        cmd = ["tsc", "-v"]
    return _execute_cmd_and_parse_version_from_output(cmd)

def _execute_cmd_and_parse_version_from_output(cmd):
    if os.name != 'nt': # Linux/MacOS
        cmd = "'" + "' '".join(cmd) + "'"
    output = subprocess.check_output(cmd, shell=True).decode('UTF-8')

    # Use regex to parse the verion number from <output> e.g. parse
    # "1.5.0-beta" from "message TS6029: Version 1.5.0-beta\r\n".
    match_object = re.search("Version\s*([\w.-]+)", output, re.IGNORECASE)
    if match_object is None:
        raise Exception("Cannot parse version number from ouput: '{0}'".format(output))
    return match_object.groups()[0]

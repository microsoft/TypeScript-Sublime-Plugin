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
    settings = sublime.load_settings('Preferences.sublime-settings')
    global_vars._language_service_enabled = settings.get('enable_typescript_language_service', True)
    print ("lang_service_enabled: " + str(global_vars.get_language_service_enabled()))
    if not global_vars.get_language_service_enabled():
        return

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

import sublime_plugin

from ..libs.global_vars import *
from ..libs import cli, logger
import os

class TypescriptOpenPluginDefaultSettingFile(sublime_plugin.WindowCommand):
    def run(self):
        default_plugin_setting_path = os.path.join(PLUGIN_DIR, "Preferences.sublime-settings")
        sublime.active_window().open_file(default_plugin_setting_path)
        
class TypescriptOpenTsDefaultSettingFile(sublime_plugin.WindowCommand):
    def run(self):
        default_ts_setting_path = os.path.join(PLUGIN_DIR, "TypeScript.sublime-settings")
        sublime.active_window().open_file(default_ts_setting_path)
        
class TypescriptOpenTsreactDefaultSettingFile(sublime_plugin.WindowCommand):
    def run(self):
        default_tsreact_setting_path = os.path.join(PLUGIN_DIR, "TypeScriptReact.sublime-settings")
        sublime.active_window().open_file(default_tsreact_setting_path)
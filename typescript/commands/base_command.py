import sublime_plugin
from ..libs.global_vars import get_language_service_enabled
from ..libs.view_helpers import is_typescript, active_view


class TypeScriptBaseTextCommand(sublime_plugin.TextCommand):
    def is_enabled(self):
        return is_typescript(self.view) and get_language_service_enabled()


class TypeScriptBaseWindowCommand(sublime_plugin.WindowCommand):
    def is_enabled(self):
        return is_typescript(self.window.active_view()) and get_language_service_enabled()


class TypeScriptBaseApplicationCommand(sublime_plugin.ApplicationCommand):
    def is_enabled(self):
        return is_typescript(active_view()) and get_language_service_enabled()

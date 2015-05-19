import sublime_plugin
from ..libs.view_helpers import is_typescript, active_view


class TypeScriptBaseTextCommand(sublime_plugin.TextCommand):
    def is_enabled(self):
        return is_typescript(self.view)


class TypeScriptBaseWindowCommand(sublime_plugin.WindowCommand):
    def is_enabled(self):
        return is_typescript(self.window.active_view())


class TypeScriptBaseApplicationCommand(sublime_plugin.ApplicationCommand):
    def is_enabled(self):
        return is_typescript(active_view())

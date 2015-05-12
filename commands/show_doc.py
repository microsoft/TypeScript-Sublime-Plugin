import sublime_plugin

from ..libs.viewhelpers import is_typescript


class TypescriptShowDoc(sublime_plugin.TextCommand):
    def is_enabled(self):
        return is_typescript(self.view)

    def run(self, text, info_str="", doc_str=""):
        self.view.insert(text, self.view.sel()[0].begin(), info_str + "\n\n")
        self.view.insert(text, self.view.sel()[0].begin(), doc_str)
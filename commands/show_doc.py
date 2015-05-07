import sublime_plugin


class TypescriptShowDoc(sublime_plugin.TextCommand):
    def run(self, text, infoStr="", docStr=""):
        self.view.insert(text, self.view.sel()[0].begin(), infoStr + "\n\n")
        self.view.insert(text, self.view.sel()[0].begin(), docStr)
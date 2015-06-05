from .base_command import TypeScriptBaseTextCommand


class TypescriptShowDoc(TypeScriptBaseTextCommand):
    def run(self, text, info_str="", doc_str=""):
        self.view.insert(text, self.view.sel()[0].begin(), info_str + "\n\n")
        self.view.insert(text, self.view.sel()[0].begin(), doc_str)
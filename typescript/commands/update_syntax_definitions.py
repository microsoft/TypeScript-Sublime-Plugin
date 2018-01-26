import urllib

from ..libs.reference import *
from .base_command import TypeScriptBaseWindowCommand

BASE_URL = "https://raw.githubusercontent.com/Microsoft/TypeScript-TmLanguage/master/"
TS_TMLANGUAGE_URL = BASE_URL + "TypeScript.tmLanguage"
TSX_TMLANGUAGE_URL = BASE_URL + "TypeScriptReact.tmLanguage"

TS_TMLANGUAGE_PATH = os.path.join(PLUGIN_DIR, "TypeScript.tmLanguage")
TSX_TMLANGUAGE_PATH = os.path.join(PLUGIN_DIR, "TypeScriptReact.tmLanguage")

class TypescriptUpdateSyntaxDefinitionsCommand(TypeScriptBaseWindowCommand):

    def run(self):
        try:
            if IS_ST2:
                urllib.urlretrieve(TS_TMLANGUAGE_URL, TS_TMLANGUAGE_PATH)
                urllib.urlretrieve(TSX_TMLANGUAGE_URL, TSX_TMLANGUAGE_PATH)
            else:
                with open(TS_TMLANGUAGE_PATH, "wb") as ts_syntax_file:
                    ts_syntax_file.write(urllib.request.urlopen(TS_TMLANGUAGE_URL).read())

                with open(TSX_TMLANGUAGE_PATH, "wb") as tsx_syntax_file:
                    tsx_syntax_file.write(urllib.request.urlopen(TSX_TMLANGUAGE_URL).read())

            sublime.message_dialog("TypeScript syntax files have been successfully updated!\nReload Sublime Text for changes to take effect.")

        except Exception as err:
            sublime.error_message("Error: {0}".format(err))


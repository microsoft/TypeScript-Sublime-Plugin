import urllib

from ..libs.reference import *
from .base_command import TypeScriptBaseWindowCommand

class TypescriptUpdateSyntaxDefinitionsCommand(TypeScriptBaseWindowCommand):

    def run(self):
        base_url = "https://raw.githubusercontent.com/Microsoft/TypeScript-TmLanguage/master/"
        new_ts_url = base_url + "TypeScript.tmLanguage"
        new_tsx_url = base_url + "TypeScriptReact.tmLanguage"
        current_ts_file = PLUGIN_DIR + "/TypeScript.tmLanguage"
        current_tsx_file = PLUGIN_DIR + "/TypeScriptReact.tmLanguage"

        try:
            if IS_ST2:
                urllib.urlretrieve(new_ts_url, current_ts_file)
                urllib.urlretrieve(new_tsx_url, current_tsx_file)
            else:
                with open(current_ts_file, "wb") as current_ts_syntax_file:
                    current_ts_syntax_file.write(urllib.request.urlopen(new_ts_url).read())

                with open(current_tsx_file, "wb") as current_tsx_syntax_file:
                    current_tsx_syntax_file.write(urllib.request.urlopen(new_tsx_url).read())
        except Exception as err:
            sublime.error_message("Error: {0}".format(err))
            return

        sublime.message_dialog("TypeScript syntax files are updated successfully!")

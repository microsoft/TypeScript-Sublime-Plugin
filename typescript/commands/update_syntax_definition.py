from ..libs.view_helpers import *
from ..libs.reference import *
from .base_command import TypeScriptBaseWindowCommand

import urllib

class TypescriptUpdateSyntaxDefinitionCommand(TypeScriptBaseWindowCommand):

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
                current_ts_syntax_file = open(current_ts_file, "wb")
                current_ts_syntax_file.write(urllib.request.urlopen(new_ts_url).read())
                current_ts_syntax_file.close()

                current_tsx_syntax_file = open(current_tsx_file, "wb")
                current_tsx_syntax_file.write(urllib.request.urlopen(new_tsx_url).read())
                current_tsx_syntax_file.close()
        except Exception as err:
            sublime.error_message("Error: {0}".format(err))
            return

        sublime.message_dialog("TypeScript syntax files are updated successfully!")
        
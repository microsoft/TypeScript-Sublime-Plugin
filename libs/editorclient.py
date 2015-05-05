import sublime, sublime_plugin
import os

from builtins import classmethod
from .globalvars import *
from .nodeclient import NodeCommClient
from .serviceproxy import ServiceProxy

class EditorClient:
    instance = None

    """ A singleton class holding information for the entire application that must be accessible globally"""
    def __init__(self):
        # retrieve the path to tsserver.js
        # first see if user set the path to the file
        settings = sublime.load_settings('Preferences.sublime-settings')
        proc_file = settings.get('typescript_proc_file')
        if not proc_file:
            # otherwise, get tsserver.js from package directory
            proc_file = os.path.join(PLUGIN_DIR, "tsserver", "tsserver.js")
        print("spawning node module: " + proc_file)
        
        self.node_client = NodeCommClient(proc_file)
        self.service = ServiceProxy(self.node_client)
        self.file_map = {}
        self.ref_info = None
        self.seq_to_tempfile_name = {}
        self.available_tempfile_list = []
        self.tmpseq = 0

        # load formatting settings and set callbacks for setting changes
        for setting_name in ['tab_size', 'indent_size', 'translate_tabs_to_spaces']:
            settings.add_on_change(setting_name, self.load_format_settings)
        self.load_format_settings()

    def load_format_settings(self):
        settings = sublime.load_settings('Preferences.sublime-settings')
        self.tab_size = settings.get('tab_size', 4)
        self.indent_size = settings.get('indent_size', 4)
        self.translate_tab_to_spaces = settings.get('translate_tabs_to_spaces', False)
        self.set_features()

    def set_features(self):
        host_info = "Sublime Text version " + str(sublime.version())
        # Preferences Settings
        format_options = {
            "tabSize": self.tab_size, 
            "indentSize": self.indent_size, 
            "convertTabsToSpaces": self.translate_tab_to_spaces
        }
        self.service.configure(host_info, None, format_options)

    def reload_required(self, view):
       client_info = self.get_or_add_file(view.file_name())
       return IS_ST2 or client_info.pending_changes or client_info.change_count < view.change_count()

    # ref info is for Find References view
    # TODO: generalize this so that there can be multiple
    # for example, one for Find References and one for build errors
    def dispose_ref_info(self):
        self.ref_info = None

    def init_ref_info(self, firstLine, refId):
        self.ref_info = RefInfo(firstLine, refId)
        return self.ref_info

    def update_ref_info(self, refInfo):
        self.ref_info = refInfo

    def get_ref_info(self):
        return self.ref_info

    def get_or_add_file(self, filename):
        """Get or add per-file information that must be globally acessible """ 
        if (os.name == "nt") and filename:
            filename = filename.replace('/','\\')
        if not filename in self.file_map:
            client_info = ClientFileInfo(filename)
            self.file_map[filename] = client_info
        else:
            client_info = self.file_map[filename]
        return client_info

    def has_errors(self, filename):
        client_info = self.get_or_add_file(filename)
        return (len(client_info.errors['syntacticDiag']) > 0) or (len(client_info.errors['semanticDiag']) > 0)

    @classmethod
    def get_instance(cls):
        if not cls.instance:
            cls.instance = EditorClient()
        return cls.instance

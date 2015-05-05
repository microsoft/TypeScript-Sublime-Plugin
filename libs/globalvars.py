import sublime, sublime_plugin
import os
from .editorclient import EditorClient

# get the directory path to this file; 
LIBS_DIR = os.path.dirname(os.path.abspath(__file__))
PLUGIN_DIR = os.path.dirname(LIBS_DIR)
PLUGIN_NAME = os.path.basename(PLUGIN_DIR)

# only Sublime Text 3 build after 3072 support tooltip
TOOLTIP_SUPPORT = int(sublime.version()) >= 3072

# determine if the host is sublime text 2
IS_ST2 = int(sublime.version()) < 3000

# Todo: add explanation
SUBLIME_WORD_MASK = 515

# the singliton EditorClient instance
cli = EditorClient.get_instance()

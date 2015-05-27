import os
import re
import logging
import sublime
from os.path import dirname


# get the directory path to this file; 
LIBS_DIR = dirname(dirname(os.path.abspath(__file__)))
PLUGIN_DIR = dirname(LIBS_DIR)
PACKAGES_DIR = dirname(PLUGIN_DIR)
PLUGIN_NAME = os.path.basename(PLUGIN_DIR)

# only Sublime Text 3 build after 3072 support tooltip
TOOLTIP_SUPPORT = int(sublime.version()) >= 3072

# determine if the host is sublime text 2
IS_ST2 = int(sublime.version()) < 3000

# detect if quick info is available for symbol
SUBLIME_WORD_MASK = 515

# set logging levels
LOG_FILE_LEVEL = logging.WARN
LOG_CONSOLE_LEVEL = logging.DEBUG

NON_BLANK_LINE_PATTERN = re.compile("[\S]+")
VALID_COMPLETION_ID_PATTERN = re.compile("[a-zA-Z_$\.][\w$\.]*\Z")

# idle time length in millisecond
IDLE_TIME_LENGTH = 200
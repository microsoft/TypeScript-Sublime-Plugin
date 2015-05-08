import os
import re

import sublime
from .logger import *


# get the directory path to this file; 
LIBS_DIR = os.path.dirname(os.path.abspath(__file__))
PLUGIN_DIR = os.path.dirname(LIBS_DIR)
PACKAGES_DIR = os.path.dirname(PLUGIN_DIR)
PLUGIN_NAME = os.path.basename(PLUGIN_DIR)

# only Sublime Text 3 build after 3072 support tooltip
TOOLTIP_SUPPORT = int(sublime.version()) >= 3072

# determine if the host is sublime text 2
IS_ST2 = int(sublime.version()) < 3000

# detect if quick info is available for symbol
SUBLIME_WORD_MASK = 515

# set logging levels
LOG_FILE_LEVEL = logging.WARN
LOG_CONSOLE_LEVEL = logging.WARN

# Todo: add explanation
NON_BLANK_LINE_PATTERN = re.compile("[\S]+")
VALID_COMPLETION_ID_PATTERN = re.compile("[a-zA-Z_$\.][\w$\.]*\Z")


def set_log_level(logger):
    logger.logFile.setLevel(LOG_FILE_LEVEL)
    logger.console.setLevel(LOG_CONSOLE_LEVEL)
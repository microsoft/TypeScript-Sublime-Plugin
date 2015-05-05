import sublime, sublime_plugin
from .servicedefs import Location


def htmlEscape(str):
    """Esacpe html content

    Note: only use for short strings
    """
    return str.replace('&','&amp;').replace('<','&lt;').replace('>',"&gt;")

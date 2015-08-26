import sublime

from .global_vars import *


class Location:
    """Object containing line and offset (one-based) of file location

    Location is a server protocol. Both line and offset are 1-based.
    """

    def __init__(self, line, offset):
        self.line = line
        self.offset = offset

    def to_dict(self):
        return {"line": self.line, "offset": self.offset}


class StaticRegion:
    """Region that will not change as buffer is modified"""

    def __init__(self, a, b):
        self.a = a
        self.b = b

    def to_region(self):
        return sublime.Region(self.a, self.b)

    def begin(self):
        return self.a

    def empty(self):
        return self.a == self.b


def copy_region(r):
    """Copy a region (this is needed because the original region may change)"""
    return sublime.Region(r.begin(), r.end())


def copy_regions(regions):
    """Copy a list of regions"""
    return [copy_region(r) for r in regions]


def region_to_static_region(r):
    """Copy a region into a static region"""
    return StaticRegion(r.begin(), r.end())


def static_regions_to_regions(static_regions):
    """Convert a list of static regions to ordinary regions"""
    return [sr.to_region() for sr in static_regions]


def regions_to_static_regions(regions):
    """Copy a list of regions into a list of static regions"""
    return [region_to_static_region(r) for r in regions]


def decrease_empty_regions(empty_regions, amount):
    """
    From a list of empty regions, make a list of regions whose begin() value is
    one before the begin() value of the corresponding input (for left_delete)
    """
    return [sublime.Region(r.begin() - amount, r.end() - amount) for r in empty_regions]


def decrease_locs_to_regions(locs, amount):
    """Move the given locations by amount, and then return the corresponding regions"""
    return [sublime.Region(loc - amount, loc - amount) for loc in locs]


def extract_line_offset(line_offset):
    """
    Destructure line and offset tuple from LineOffset object
    convert 1-based line, offset to zero-based line, offset
    ``lineOffset`` LineOffset object
    """
    if isinstance(line_offset, dict):
        line = line_offset["line"] - 1
        offset = line_offset["offset"] - 1
    else:
        line = line_offset.line - 1
        offset = line_offset.offset - 1
    return line, offset


def escape_html(raw_string):
    """Escape html content

    Note: only use for short strings
    """
    return raw_string.replace('&', '&amp;').replace('<', '&lt;').replace('>', "&gt;")


def left_expand_empty_region(regions, number=1):
    """Expand region list one to left for backspace change info"""
    result = []
    for region in regions:
        if region.empty():
            result.append(sublime.Region(region.begin() - number, region.end()))
        else:
            result.append(region)
    return result


def right_expand_empty_region(regions):
    """Expand region list one to right for delete key change info"""
    result = []
    for region in regions:
        if region.empty():
            result.append(sublime.Region(region.begin(), region.end() + 1))
        else:
            result.append(region)
    return result


def build_replace_regions(empty_regions_a, empty_regions_b):
    """
    Given two list of cursor locations, connect each pair of locations for form
    a list of regions, used for replacement later
    """
    rr = []
    for i in range(len(empty_regions_a)):
        rr.append(sublime.Region(empty_regions_a[i].begin(), empty_regions_b[i].begin()))
    return rr
    
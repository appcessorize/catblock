"use strict";

// Show resourceblock page
$("body").fadeIn();

// Get tabId from URL
var tabId = parseURI.parseSearch(document.location.href).tabId;
tabId = parseInt(tabId);

// Convert element type to request type
function reqTypeForElement(elType) {
    switch (parseInt(elType)) {
        case 1:    return "script";
        case 2:    return "image";
        case 4:    return "stylesheet";
        case 8:    return "object";
        case 16:   return "subdocument";
        case 32:   return "object_subrequest";
        case 64:   return "other";
        case 128:  return "xmlhttprequest";
        case 256:  return "document";
        case 512:  return "elemhide";
        case 1024: return "popup";
        case 2048: return "ping";
        case 4096: return "media";
        default:   return "selector";
    }
}

// Fill in frame URLs into frame selector
function prepopulateFrameSelect(tabId) {
    // Remove all frame options
    $("#frame").find("option").remove();

    BGcall("get_frameData", tabId, function(tabFrames) {
        for (let id in tabFrames) {
            if (isNaN(id)) {
                return;
            }
            if (id === "0") {
                $("#frame").append($("<option>", { value: id, text: "Main frame" }));
            } else {
                $("#frame").append($("<option>", { value: id, text: tabFrames[id].url }));
            }
        }
    });
}
prepopulateFrameSelect(tabId);

// Frame was changed, hide all tables
// and display table for a requested frame
$("#frame").change(function(event) {
    $("#search").val("");
    $(".resourceslist").hide();

    let frameId = event.target.value;
    let selector = document.querySelector(".resourceslist[data-frameid='" + frameId + "']")

    if (!selector) {
        $("#warning").fadeIn();
    } else {
        $("#warning").hide();
        $(".resourceslist[data-frameid='" + frameId + "']").css("display", "table");
    }
});

// Resources search handler
$("#search").on("input", function() {
   let value = $("#search").val();

    $(".resourceslist:visible").find("td[data-column='url']").each(function(index, elem) {
        if (elem.innerText.indexOf(value) === -1) {
            $(elem.parentElement).hide();
        } else {
            $(elem.parentElement).show();
        }
    });
});

// Reset cache for getting matched filter text properly
BGcall("reset_matchCache", function(matchCache) {
    // Get frameData object
    BGcall("get_frameData", tabId, function(frameData) {
        if (!frameData || Object.keys(frameData["0"].resources).length === 0) {
            alert(translate("noresourcessend2"));
            window.close();
            return;
        } else {
            BGcall("storage_get", "filter_lists", function(filterLists) {
                // TODO: Excluded filters & excluded hiding filters?
                for (var id in filterLists) {
                    // Delete every filter list we are not subscribed to
                    if (!filterLists[id].subscribed) {
                        delete filterLists[id];
                        continue;
                    }
                    // Process malware filter list separately
                    if (id !== "malware") {
                        filterLists[id].text = filterLists[id].text.split("\n");
                    }
                }

                BGcall("get_settings", function(settings) {
                    // Process AdBlock's own filters (if any)
                    filterLists.AdBlock = {};
                    filterLists.AdBlock.text = MyFilters.prototype.getExtensionFilters(settings);

                    BGcall("storage_get", "custom_filters", function(filters) {
                        // Process custom filters (if any)
                        if (filters) {
                            filterLists.Custom = {};
                            filterLists.Custom.text = FilterNormalizer.normalizeList(filters).split("\n");
                        }

                        // Pre-process each resource - extract data from its name
                        // and add them into resource's object for easier manipulation
                        for (var frameId in frameData) {
                            var frame = frameData[frameId];
                            var frameResources = frame.resources;

                            // Process each resource
                            for (var resource in frameResources) {
                                var res = frameResources[resource] = {};

                                res.elType = resource.split(":|:")[0];
                                res.url = resource.split(":|:")[1];
                                res.frameDomain = resource.split(":|:")[2].replace("www.", "");
                                res.time = resource.split(":|:")[3];

                                if (res.elType !== "selector") {
                                    res.thirdParty = BlockingFilterSet.checkThirdParty(new parseURI(res.url).hostname, res.frameDomain);
                                }
                            }
                        }

                        // Find out, whether resource has been blocked/whitelisted,
                        // if so, get the matching filter and filter list,
                        // where is the matching filter coming from
                        BGcall("process_frameData", frameData, function(processedData) {
                            for (var frameId in processedData) {
                                var frame = processedData[frameId];
                                var frameResources = frame.resources;

                                for (var resource in frameResources) {
                                    var res = frameResources[resource];
                                    if (res.elType !== "selector") {
                                        if (res.blockedData && res.blockedData !== false && res.blockedData.text) {
                                            var filter = res.blockedData.text;
                                            for (var filterList in filterLists) {
                                                if (filterList === "malware") {
                                                    if (filterLists[filterList].text.adware.indexOf(filter) > -1) {
                                                        res.blockedData.filterList = filterList;
                                                    }
                                                } else {
                                                    var filterListText = filterLists[filterList].text;
                                                    for (var i=0; i<filterListText.length; i++) {
                                                        var filterls = filterListText[i];
                                                        if (filterls === filter) {
                                                            res.blockedData.filterList = filterList;
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    } else {
                                        for (var filterList in filterLists) {
                                            // Don't check selector against malware filter list
                                            if (filterList === "malware") {
                                                continue;
                                            }
                                            var filterListText = filterLists[filterList].text;
                                            for (var i=0; i<filterListText.length; i++) {
                                                var filter = filterListText[i];
                                                // Don't check selector against non-selector filters
                                                if (!Filter.isSelectorFilter(filter)) {
                                                    continue;
                                                }
                                                if (filter.indexOf(res.url) > -1) {
                                                    // If |filter| is global selector filter,
                                                    // it needs to be the same as |resource|.
                                                    // If it is not the same as |resource|, keep searching for a right |filter|
                                                    if ((filter.split("##")[0] === "" && filter === res.url) ||
                                                        filter.split("##")[0].indexOf(res.frameDomain) > -1) {
                                                        // Shorten lengthy selector filters
                                                        if (filter.split("##")[0] !== "") {
                                                            filter = res.frameDomain + res.url;
                                                        }
                                                        res.blockedData = {};
                                                        res.blockedData.filterList = filterList;
                                                        res.blockedData.text = filter;
                                                        res.frameUrl = frame.url;
                                                        break;
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            // Add previously cached requests to matchCache
                            BGcall("add_to_matchCache", matchCache, function() {
                                addRequestsToTables(processedData);
                            });
                        });
                    });
                });
            });
        }
    });
});


// Process each request and add it to table
function addRequestsToTables(frames) {
    for (var frame in frames) {
        var frameObject = frames[frame];

        // Don't process number of blocked ads (blockCount)
        if (typeof frameObject === "number") {
            continue;
        }

        var resLength = Object.keys(frameObject.resources).length;

        // Don't create a table with 0 requests
        if (resLength === 0) {
            continue;
        }

        // Create a table for each frame
        createTable(frameObject.domain, frameObject.url, frame);

        // Process each request
        for (var resource in frameObject.resources) {
            var res = frameObject.resources[resource];

            // Create a row for each request
            var row = $("<tr>");

            // Add a class according to the request's status
            if (reqTypeForElement(res.elType) === "selector") {
                row.addClass("hiding");
            } else if (res.blockedData) {
                if (res.blockedData.blocked) {
                    row.addClass("blocked");
                } else {
                    row.addClass("whitelisted");
                }
            }

            // Cell 1: Time
            $("<td>").
            attr("data-column", "time").
            text(res.time).
            appendTo(row);

            // Cell 2: Type
            $("<td>").
            attr("data-column", "type").
            text(reqTypeForElement(res.elType)).
            appendTo(row);

            // Cell 3: Matching filter
            var cell = $("<td>").
            attr("data-column", "filter");
            if (res.blockedData && res.blockedData.text && res.blockedData.filterList) {
                $("<span>").
                text(res.blockedData.text).
                attr("title", translate("filterorigin", translate("filter" + res.blockedData.filterList))).
                appendTo(cell);
            }
            row.append(cell);

            // Cell 4: URL
            $("<td>").
            attr("title", res.url).
            attr("data-column", "url").
            text(res.url).
            appendTo(row);

            // Cell 5: third-party or not
            var cell = $("<td>").
            text(res.thirdParty ? translate("yes") : translate("no")).
            attr("title", translate("resourcedomain", res.frameDomain)).
            attr("data-column", "thirdparty");
            row.append(cell);

            // Finally, append processed resource to the relevant table
            $("[data-href='" + frameObject.domain + "'] tbody").append(row);
        }
    }

    // Remove loading icon
    $(".loader").fadeOut();

    // Localize page
    localizePage();
    $(".legendtext").text(translate("legend"));
    $("span.blocked").text(translate("blockedresource"));
    $("span.whitelisted").text(translate("whitelistedresource"));
    $("span.hiding").text(translate("hiddenelement"));

    // Show us the legend
    $("#legend").fadeIn();

    // Enable table sorting
    $("th[data-column='time']").click(sortTable);
    $("th[data-column='url']").click(sortTable);
    $("th[data-column='type']").click(sortTable);
    $("th[data-column='filter']").click(sortTable);
    $("th[data-column='thirdparty']").click(sortTable);

    // Sort table according to time
    $("th[data-column='time']").click();

    // Finally, show us the main frame table
    $("#frameselect, #searchresources").fadeIn();
    $(".resourceslist[data-frameid='0']").css("display", "table");
}

// Create a new table for frame
function createTable(domain, url, frameId) {
    var elem = null, frameType = null, frameUrls = $(".frameurl");

    // Don't create another table with the same url,
    // when we've already created one
    for (var i=0; i<frameUrls.length; i++) {
        var frameUrl = frameUrls[i].title;
        if (url === frameUrl) {
            return;
        }
    }

    // Main frame table is always on top of the page
    if (frameId === "0") {
        elem = "#warning";
    } else {
        var len = document.querySelectorAll(".resourceslist").length;
        elem = document.querySelectorAll(".resourceslist")[len-1];
    }

    // Insert table to page
    $(elem).after(
        "<table data-href=" + domain + " data-frameid=" + frameId + " class='resourceslist'>" +
        "<thead>" +
        "<tr>" +
        "<th data-column='time'>" + "Time" + "<\/th>" +
        "<th data-column='type'>" + translate("headertype") + "<\/th>" +
        "<th data-column='filter'>" + translate("headerfilter") + "<\/th>" +
        "<th data-column='url'>" + translate("headerresource") + "<\/th>" +
        "<th data-column='thirdparty'>" + translate("thirdparty") + "<\/th>" +
        "<\/tr>" +
        "<\/thead>" +
        "<tbody>" +
        "<\/tbody>" +
        "<\/table>"
    );
}

// Click event for the column titles (<th>) of a table.
// It'll sort the table upon the contents of that column
function sortTable() {
    var table = $(this).closest("table");
    if (table.find("[colspan]").length) {
        return; // can't handle the case where some columns have been merged locally
    }
    var columnNumber = $(this).prevAll().length + 1;
    if ($(this).attr("data-sortDirection") === "ascending") {
        $(this).attr("data-sortDirection", "descending"); // Z->A
    } else {
        $(this).attr("data-sortDirection", "ascending"); // A->Z
    }
    var cellList = [];
    var rowList = [];
    $("td:nth-of-type(" + columnNumber + ")", table).each(function(index, element) {
        cellList.push(element.innerHTML.toLowerCase() + "ÿÿÿÿÿ" + (index+10000));
        rowList.push($(element).parent("tr").clone(true));
    });
    cellList.sort();
    if ($(this).attr("data-sortDirection") === "descending") {
        cellList.reverse();
    }
    $("tbody", table).empty();
    cellList.forEach(function(item) {
        var no = Number(item.match(/\d+$/)[0]) - 10000;
        $("tbody", table).append(rowList[no]);
    });
}
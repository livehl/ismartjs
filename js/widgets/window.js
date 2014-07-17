/**
 * Created by Administrator on 2014/6/11.
 */
(function ($) {
    var SCRIPT_RE = /<script((?:.|\s)*?)>((?:.|\s)*?)<\/script>/gim;
    var META_RE = /<meta(.*?)\/>/gim;
    var META_ITEM_RE = /(\S+)=(['"])([^\2]*?)\2/gi;

    var META_VALUE_RE = /\{%=(.*)%}/gi;

    var parseMeta = function (str) {
        var meta = {};
        str.replace(META_ITEM_RE, function ($0, $1, $2, $3) {
            meta[$1] = $3;
        });

        //特殊处理args参数
        if (meta.args && meta.args.length) {
            var argsStr = $.trim(meta.args);
            meta.args = [];
            $.each(argsStr.split(","), function (i, arg) {
                meta.args.push($.trim(arg));
            });
        }

        return meta;
    };
    var parseHtml = function (html) {
        var scriptTexts = [];
        var scriptSrcs = [];
        var meta = {};
        html = html.replace(META_RE, function ($0, $1) {
            meta = parseMeta($1);
            return "";
        });
        html = html.replace(SCRIPT_RE, function ($0, $1, $2) {
            var srcGroup = /src=(\S+)?/gi.exec($1);
            if (srcGroup && srcGroup.length == 2) {
                scriptSrcs.push(srcGroup[1].replace(/['"]/g, ""));
            }
            scriptTexts.push($2);
            return "";
        });
        return {
            meta: meta,
            html: html,
            scriptTexts: scriptTexts,
            scriptSrcs: scriptSrcs
        }
    };

    var process = function (result, href, loadArgs) {
        var html = result.html;
        loadArgs = loadArgs || {};
        var scriptTexts = result.scriptTexts;
//        var applyArgs = Smart.SLICE.call(arguments, 2);
        var scripts = [];
        //处理模板
        var meta = result.meta;
        var argsScripts = [];
        var metaScripts = [];
        scripts.push("(function(){");
        scripts.push("    return function(){");
        if (meta.args) { //如果有参数定义，那么参数的值是
            var windowOpenArgsVar = "__WINDOW_OPEN_ARGS_VAR__";
            //传递进来的加载参数对象是第二个参数。
            $.each(meta.args, function (i, arg) {
                var argSeg = arg.split(":");
                var argStr = "var " + argSeg[0] + " = arguments[0]['" + argSeg[0] + "'];\n";
                metaScripts.push("var " + argSeg[0] + " = arguments[1]['" + argSeg[0] + "'];");
                if(argSeg.length == 2){
                    var tmpStr =  argSeg[0] + " = " +argSeg[0] + " !==undefined ? " + argSeg[0] + " : " + argSeg[1] + ";";
                    argStr += tmpStr + "\n";
                    metaScripts.push(tmpStr);
                }
                argsScripts.push(argStr);
                scripts.push(argStr);
            });
        }
        scripts.push("var S = this;");
        scripts.push(scriptTexts.join("\n"));
        scripts.push("			return function(key){");
        scripts.push("				try{");
        scripts.push("					key += ';//@ sourceURL=" + href + "_context.js'");
        scripts.push("					return eval(key);");
        scripts.push("				}catch(e){Smart.error(e);}");
        scripts.push("			};");
        scripts.push("		};");
        scripts.push("})();//@ sourceURL=" + href + ".js");
        if (meta.template == "true") {//如果需要模板化处理才进行模板化处理。不做统一全部处理
            var compiledFnBody = [];
            compiledFnBody.push("(function(){");
            compiledFnBody.push("   return function(){\n");
            compiledFnBody.push(argsScripts.join("\n"));
            compiledFnBody.push($.template.compile(html));
            compiledFnBody.push("   }");
            compiledFnBody.push("})();//@ sourceURL=" + href + "_template.js");
            var fn = eval(compiledFnBody.join("\n"));
            html = fn.call(this, loadArgs);
            html = html.replace(/\n{2,}/gm, "\n");
        }
        //替换掉id,为id加上当前窗口的窗口id TODO 正则表达式无法匹配，采用jQuery的方法替换
        //html = this._tidyId(html);

        this._WNODE = $(html);

        //替换掉id,为id加上当前窗口的窗口id TODO 正则表达式无法匹配，采用jQuery的方法替换
        var that = this;
        this._WNODE.find("*[id]").add(this._WNODE.filter("*[id]")).each(function () {
            var id = $(this).attr("id");
            $(this).attr("id", that.trueId(id)).attr("_id_", id);
        });
        this.meta = meta;
        var metaScript = metaScripts.join("\n");
        metaScript += "\n  try{\n return eval(arguments[0]);\n}catch(e){\nreturn null}";
        var metaScript = new Function(metaScript);
        $.each(meta, function (key, val) {
            if (key == 'args') {
                return;
            }
            meta[key] = val.replace(META_VALUE_RE, function ($0, $1) {
                return metaScript.apply(this, [$1, loadArgs]);
            });
        });

        this.node.empty().append(this._WNODE);
        var scriptFn = eval(scripts.join("\n"));
        var context = scriptFn.call(this, loadArgs);
        this.setContext(context);

        var that = this;
        this.on("window.document.ready", function(e){e.stopPropagation()});
        this.makeChildren().done(function(){
            that.trigger("window.document.ready");
        });

        //处理锚点滚动
        if (href.indexOf("#") != -1) {
            var anchor = href.substring(href.indexOf("#"));
            this.scrollTo(anchor);
        }
    };

    var CURRENT_WINDOW_ID = 0;

    var ON_BEFORE_CLOSE_FN_KEY = "_onBeforeCloseFns_";
    var EVENT_ON_CACHE = "_EVENT_ON_CACHE";

    var STOP_ANCHOR_SCROLLIN_KEY = "_stop_anchor_scrollin_";

    Smart.widgetExtend({
        id: "window",
        options: "href,args"
    }, {
        onPrepare: function () {
            this.S._WINDOW_ID = "_w_" + (CURRENT_WINDOW_ID++);
            this.cache[ON_BEFORE_CLOSE_FN_KEY] = [];
            this.cache[EVENT_ON_CACHE] = [];
            this.location = {
                href: this.options.href,
                args: this.options.args
            };
            if (!this.S.node.attr("id")) {
                this.S.node.attr("id", this.S._WINDOW_ID);
            }
        },
        onReady: function () {
            var deferred = $.Deferred();
            if (this.location.href) {
                this.S.load.apply(this.S, [this.location.href].concat(this.location.args || [])).always(function () {
                    deferred.resolve()
                });
                return deferred.promise();
            } else {
                return deferred.resolve();
            }
        },
        onClean: function(){
            this.cache[ON_BEFORE_CLOSE_FN_KEY] = [];
            this.S.node.html("正在刷新");
        },
        onDestroy: function(){
            this.onClean();
            this.S._offEvent();
            this.S.node.empty();
        }
    }, {
        _offEvent: function(){
            var that = this;
            $.each(this.widget.window.cache[EVENT_ON_CACHE], function (i, paramAry) {
                that.off.apply(that, paramAry);
            });
            this.widget.window.cache[EVENT_ON_CACHE] = [];
        },
        load: function (href, loadArgs) {
            this.widget.window.cache["loadState"] = true;//是否已经加载
            this._offEvent();
            this.trigger("loading");
            var deferred = $.Deferred();
            var args = $.makeArray(arguments);
            this.widget.window.location.args = args;
            var that = this;
            this.widget.window.location.href = href;
            this.get(href, null, "text").done(function (html) {
                var result = parseHtml(html);
                var scriptSrcs = result.scriptSrcs;
                Smart.loadFiles(scriptSrcs, href).done(function () {
                    process.apply(that, [result].concat(args));
                    //当页面存在锚点的时候，页面滚动的时候，监听锚点的位置，并触发事件。
                    that._listenAnchorPos();
                }).fail(function () {
                    Smart.error(href + "的依赖处理失败");
                }).always(function () {
                    that.trigger("load");
                    deferred.resolve(that);
                });
            }).fail(function () {
                that.trigger("load");
            });
            return deferred;
        },
        setMeta: function (key, value) {
            this.meta[key] = value;
            this.trigger("meta", key, value);
        },
        scrollTo: function (selector) {
            var anchorNode = selector;
            if ($.type(selector) == "string") {
                anchorNode = this.N(selector);
            }
            var deferred = $.Deferred();
            if (anchorNode.size() != 0) {
                var pos = anchorNode.position();
                var scrollTop = this.node.scrollTop();
                this.node.animate({
                    scrollTop: scrollTop + pos.top + "px"
                }, 400, "easeOutQuint", function () {
                    deferred.resolve();
                });
            } else {
                deferred.resolve();
            }
            return deferred;
        },
        scrollToAnchor: function (id) {
            this.widget.window.cache[STOP_ANCHOR_SCROLLIN_KEY] = true;
            var that = this;
            return this.scrollTo("#" + id).done(function () {
                delete that.widget.window.cache[STOP_ANCHOR_SCROLLIN_KEY];
            });
        },
        _listenAnchorPos: function () {
            var nodes = this._getAnchorNodes();
            var nodesLength = nodes.size();
            if (nodesLength > 0) {
                var that = this;
                var anchorScrollListener = function () {
                    if (that.widget.window.cache[STOP_ANCHOR_SCROLLIN_KEY]) {
                        return;
                    }
                    var height = $(this).innerHeight();
                    for (var i = 0; i < nodesLength; i++) {
                        var node = $(nodes[i]);
                        var posTop = node.position().top;
                        if (posTop <= height / 3 && posTop >= 0) {
                            that.trigger("anchor.scrollin", node.attr("_id_"));
                            return;
                        }
                    }
                };
                this.on("clean", function () {
                    that.node.unbind("scroll", anchorScrollListener);
                });
                this.node.scroll(anchorScrollListener).on("anchor.scrollin", function (e) {
                    e.stopPropagation();
                });
            }
        },
        getAnchors: function () {
            var anchors = this.widget.window.cache['_anchors_'];
            if (!anchors) {
                anchors = [];
                this.widget.window.cache['_anchors_'] = anchors;
                this._getAnchorNodes().each(function () {
                    var n = $(this);
                    anchors.push({id: n.attr("_id_"), title: n.attr("title")});
                });
            }
            return anchors;
        },
        _getAnchorNodes: function () {
            var attrName = Smart.optionAttrName("window", "role");
            return this.node.find("*[" + attrName + "='a']");
        },
        //预关闭；
        preClose: function () {
            var deferred = $.Deferred();
            var onBeforeCloseFns = this.widget.window.cache[ON_BEFORE_CLOSE_FN_KEY];
            if (onBeforeCloseFns.length > 0) {
                Smart.deferredQueue(onBeforeCloseFns.reverse()).then(function () {
                    deferred.resolve();
                }, function () {
                    deferred.reject();
                });
            } else {
                return deferred.resolve();
            }
            return deferred.promise();
        },

        open: function () {
            var deferred = $.Deferred();
            var e = $.Event("open", {deferred: deferred, smart: this});
            this.trigger(e, $.makeArray(arguments));
            return deferred;
        },

        close: function () {
            //触发beforeClose监听事件。
            var that = this;
            var args = arguments;
            that.widget.window.cache = {};
            var deferred = $.Deferred();
            deferred.done(function () {
                that.node.remove();
            });
            var event = $.Event("close", {deferred: deferred});
            that.trigger(event, Smart.SLICE.call(args));
            event.deferred['resolve'] && event.deferred.resolve();
        },
        closeWithConfirm: function () {
            var that = this;
            var args = arguments;
            return this.preClose().done(function () {
                that.close.apply(that, Smart.SLICE.call(args));
            });
        },
        //监听窗口关闭事件。
        onBeforeClose: function (fn) {
            this.widget.window.cache[ON_BEFORE_CLOSE_FN_KEY].push(fn);
            return this;
        },

        action: function (script) {
            var script_body = [];
//            script_body.push(" var e = arguments[1]; ");
//            script_body.push(script);
//            script_body = script_body.join("\n");
//            var ___context_holder__ = this;
//            var action = function (e) {
//                ___context_holder__.context.apply(this, [script_body, e]);
//            };
//            return action;
            script_body.push("(function(){");
            script_body.push("      return function(){");
            script_body.push("          " + script);
            script_body.push("      }")
            script_body.push("})()");
            return this.context(script_body.join("\n"));
        },
        _tidyId: function (html) {//整理清理html，
            //清理html的id
            var that = this;
            html = html.replace(/<\w+\s+(id=['"])(.+)(['"])\s*?[^>]*?>/gi, function ($0, $1, $2, $3) {
                return $1 + that.trueId($2) + $3;
            });
            return html;
        },
        S: function (selector) {
            return Smart.of(this.N(selector));
        },
        N: function (selector) {
            var _selector = [];
            selector = selector.split(",");
            if (selector.length == 1) {
                selector = selector[0];
                if (selector.charAt(0) == "#") {
                    selector = "#" + this.trueId(selector.substring(1));
                }
            } else {
                for (var i = 0; i < selector.length; i++) {
                    var _sel = $.trim(selector[i]);
                    if (_sel.charAt(0) == "#") {
                        _sel = "#" + this.trueId(_sel.substring(1));
                    }
                    _selector.push(_sel);
                }
                selector = _selector.join(",");
            }

            return this._WNODE.filter(selector).add(this._WNODE.find(selector));
        },
        trueId: function (id) {
            return this._WINDOW_ID + "_" + id;
        },
        //这里修改on的方法，当页面渲染完成之后所有的on的事件都缓存起来，在refresh，和load新页面的时候要去除掉这些事件。
        on: function (events, selector, fn) {
            if (this.widget.window.cache.loadState) {
                //如果已经加载了，on的事件将会被记录，在重新load的时候会移除掉这些事件。
                this.widget.window.cache[EVENT_ON_CACHE].push([events, selector, fn]);
            }
            return this.inherited([events, selector, fn]);
        }
    });
})(jQuery);
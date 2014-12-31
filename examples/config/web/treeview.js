//
// Vlad Seryakov 2014
//
// Based on Jonathan Miles https://github.com/jonmiles/bootstrap-treeview
//

;(function($, window, document, undefined) {
    'use strict';

    var Treeview = function(element, options) {
        this.$element = $(element);
        this._element = element;
        this._init(options);
    }

    Treeview.DEFAULTS = {
        expandIcon: 'glyphicon glyphicon-plus',
        collapseIcon: 'glyphicon glyphicon-minus',
        nodeIcon: 'glyphicon glyphicon-stop',
        onSelected: undefined,
    };

    Treeview.prototype.remove = function() {
        this._destroy();
        $.removeData(this, 'bs.treeview');
    }

    Treeview.prototype.getNodes = function() {
        return this.nodes || this._nodes;
    }

    Treeview.prototype._init = function(options) {
        if (!options) options = {};
        this.tree = [];
        this.nodes = [];
        this.selectedNode = {};
        if (options.nodes) {
            this.tree = $.extend(true, [], options.nodes);
            delete options.nodes;
        }
        this.options = $.extend({}, Treeview.DEFAULTS, options);
        this._destroy();
        this.$element.off('click');
        this.$element.on('click', $.proxy(this._clickHandler, this));
        if (typeof this.options.onSelected === 'function') {
            this.$element.on('onSelected', this.options.onSelected);
        }
        this._openNodes(this.tree);
        this._render();
    };

    Treeview.prototype._destroy = function() {
        if (this.initialized) {
            this.$wrapper.remove();
            this.$wrapper = null;
            this.$element.off('click');
        }
        this.initialized = false;
    }

    Treeview.prototype._clickHandler = function(event) {
        event.preventDefault();
        var target = $(event.target)
        var classList = target.attr('class') ? target.attr('class').split(' ') : [];
        var nodeId = target.closest('li.list-group-item').attr('data-nodeid');
        var node = this.nodes[nodeId];

        if (classList.indexOf('click-expand') > -1 || classList.indexOf('click-collapse') > -1) {
            node._open = node._open ? 0 : 1;
            this._render();
        } else
        if (node) {
            if (node === this.selectedNode) {
                this.selectedNode = {};
            } else {
                this.$element.trigger('onSelected', [$.extend(true, {}, this.selectedNode = node)]);
            }
            this._render();
        }
    }

    Treeview.prototype._openNodes = function(nodes) {
        var self = this;
        $.each(nodes, function(id, node) {
            if (node.id && self.options.open && self.options.open[node.id]) node._open = node._open ? 0 : 1;
            if (node.nodes) self._openNodes(node.nodes);
        });
    }

    Treeview.prototype._render = function() {
        if (!this.initialized) {
            this.initialized = true;
            this.$element.addClass('treeview');
            this.$wrapper = $('<ul class="list-group"></ul>');
        }
        this.$element.empty().append(this.$wrapper.empty());
        this.nodes = [];
        this._buildTree(this.tree, 0);
    }

    Treeview.prototype._buildTree = function(nodes, level) {
        var self = this;
        if (!nodes) return;
        level += 1;

        $.each(nodes, function(id, node) {
            node.nodeId = self.nodes.length;
            self.nodes.push(node);

            var treeItem = $('<li class="list-group-item"></li>').addClass('node').addClass((node === self.selectedNode) ? 'selected' : '').attr('data-nodeid', node.nodeId);
            for (var i = 0; i < (level - 1); i++) {
                treeItem.append('<span class="indent"></span>');
            }

            if (node.nodes && node._open) {
                treeItem.append($('<span class="icon"></span>').append($('<i></i>').addClass('click-collapse').addClass(self.options.collapseIcon)));
            } else
            if (node.nodes && !node._open) {
                treeItem.append($('<span class="icon"></span>').append($('<i></i>').addClass('click-expand').addClass(self.options.expandIcon)));
            } else {
                treeItem.append($('<span class="icon"></span>').append($('<i></i>').addClass('glyphicon')));
            }
            treeItem.append($('<span class="icon"></span>').append($('<i></i>').addClass(node.icon || self.options.nodeIcon)));
            treeItem.append(node.text);

            if (node.tags) {
                $.each(node.tags, function addTag(id, tag) {
                    treeItem.append($('<span class="badge"></span>').append(tag));
                });
            }
            self.$wrapper.append(treeItem);
            if (node.nodes && node._open) self._buildTree(node.nodes, level);
        });
    }

    function Plugin(option) {
        var rc = null
        var self = this.each(function () {
            var $this = $(this);
            var data = $this.data('bs.treeview');
            if (!data) $this.data('bs.treeview', (data = new Treeview(this)));
            var action = typeof option == 'string' ? option : "_init";
            if (action) rc = data[action](typeof option == "object" && option);
        });
        return rc || self;
    }

    $.fn.treeview = Plugin
    $.fn.treeview.Constructor = Treeview

})(jQuery, window, document);

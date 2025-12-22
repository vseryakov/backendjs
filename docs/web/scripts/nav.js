function scrollToNavItem() {
    var path = window.location.href.split('/').pop().replace(/\.html/, '');
    document.querySelectorAll('nav a').forEach(function(link) {
      var href = link.attributes.href.value.replace(/\.html/, '');
      if (path === href) {
        link.scrollIntoView({block: 'center'});
        return;
      }
    })
}

function lineNumbers() {
    var source = document.getElementsByClassName('prettyprint source linenums');
    if (!source || !source[0]) return;
    var anchorHash = document.location.hash.substring(1);
    var lines = source[0].getElementsByTagName('li');

    for (var i = 0 ; i < lines.length; i++) {
        var lineId = 'line' + (i + 1);
        lines[i].id = lineId;
        if (lineId === anchorHash) {
            lines[i].className += ' selected';
            lines[i].scrollIntoView({block: 'center'});
        }
    }
}
setTimeout(() => {
    scrollToNavItem();
    prettyPrint();
    lineNumbers();
}, 100);


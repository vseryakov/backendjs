
module.exports.defaults = {

    avatar: {
        gravity: "east",
        padding: 70,
        width: 500,
        height: 500,
        radius: 10,
        border: 15,
        color: "#ffffff70"
    },

    logo: {
        gravity: "northwest",
        width: 160,
        height: 160,
        padding: 200,
        fit: "cover",
    },

    title: {
        gravity: "west",
        padding_top: 20,
        padding: 70,
        width: 700,
        dpi: 600,
        font: "Roboto",
        color: "#fff",
        weight: "bold",
    },

    subtitle: {
        gravity: "southwest",
        padding: 70,
        width: 700,
        dpi: 400,
        font: "Sans Serif",
        color: "#eee",
        weight: "bold",
        style: "italic",
    },

    name: {
        gravity: "southeast",
        padding: 70,
        dpi: 300,
        font: "Montserrat, Helvetica Neue, Arial, Sans Serif",
        color: "#fff",
        weight: "bold",
    },

    image: {
        width: 1280,
        height: 1280,
        background: "#000",
        fit: "cover",
    },
};

module.exports.properties = {
    file: {},
    text: {},
    size: {},
    font: {},
    fontfile: {},
    spacing: { type: "int" },
    align: {},
    justify: { type: "bool" },
    wrap: {},
    dpi: { type: "int" },
    weight: {},
    style: { type: "bool" },
    width: { type: "int" },
    height: { type: "int" },
    background: {},
    color: {},
    gravity: {},
    radius: { type: "int" },
    border: { type: "int" },
    bcolor: {},
    bradius: { type: "int" },
    padding: { type: "int" },
    padding_x: { type: "int" },
    padding_y: { type: "int" },
    padding_top: { type: "int" },
    padding_bottom: { type: "int" },
    padding_left: { type: "int" },
    padding_right: { type: "int" },
    fit: {},
    position: {},
    kernel: {},
    withoutEnlargement: { type: "bool" },
    withoutReduction: { type: "bool" },
    fastShrinkOnLoad: { type: "bool" },
};

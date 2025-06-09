/* global  */

const config = [
    { get: "/ping" },
    { url: "/auth", status: 417 },
    { url: "/login", data: { login: "test", secret: "test1" }, status: 401 },
    { url: "/login", data: { login: "test", secret: "test" } },
    { url: "/auth" },
];

tests.test_access = function(callback, test)
{
    tests.checkAccess({ config }, callback);
}



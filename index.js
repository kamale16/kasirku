// Titik masuk untuk Vercel: file ini harus mengimpor express dan mengekspor app-nya.
const express = require("express");
const { createApp } = require("./src/app");

module.exports = createApp(express);

module.exports = function(eleventyConfig) {
    eleventyConfig.addPassthroughCopy("assets");

    return {
        markdownTemplateEngine: 'njk',
        htmlTemplateEngine: 'njk'
    }
}
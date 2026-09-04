import { defineConfig } from "vitepress";

// https://vitepress.dev/reference/site-config
export default defineConfig({
	title: "NPM Edge",
	description: "Self-hosted edge routing, TLS termination, and recoverable proxy configuration",
	head: [
		["link", { rel: "icon", href: "/icon.png" }],
		[
			"meta",
			{
				name: "description",				content:
					"NPM Edge is the Innotel self-hosted edge component for proxy hosts, TLS termination, access policies, and recoverable Nginx Proxy Manager state.",
			},
		],
		["meta", { property: "og:title", content: "NPM Edge" }],
		[
			"meta",
			{
				property: "og:description",				content:
					"NPM Edge is the Innotel self-hosted edge component for proxy hosts, TLS termination, access policies, and recoverable Nginx Proxy Manager state.",
			},
		],
		["meta", { property: "og:type", content: "website" }],
		["meta", { property: "og:url", content: "https://innotelinc.github.io/npm/" }],
		[
			"meta",
			{
				property: "og:image",
				content: "https://innotelinc.github.io/npm/icon.png",
			},
		],
		["meta", { name: "twitter:card", content: "summary" }],
		["meta", { name: "twitter:title", content: "NPM Edge" }],
		[
			"meta",
			{
				name: "twitter:description",				content:
					"NPM Edge is the Innotel self-hosted edge component for proxy hosts, TLS termination, access policies, and recoverable Nginx Proxy Manager state.",
			},
		],
		[
			"meta",
			{
				name: "twitter:image",
				content: "https://innotelinc.github.io/npm/icon.png",
			},
		],
		["meta", { name: "twitter:alt", content: "NPM Edge" }],
		// GA
		[
			"script",
			{
				async: "true",
				src: "https://www.googletagmanager.com/gtag/js?id=G-TXT8F5WY5B",
			},
		],
		[
			"script",
			{},
			"window.dataLayer = window.dataLayer || [];\nfunction gtag(){dataLayer.push(arguments);}\ngtag('js', new Date());\ngtag('config', 'G-TXT8F5WY5B');",
		],
	],
	sitemap: {
		hostname: "https://innotelinc.github.io/npm",
	},
	metaChunk: true,
	srcDir: "./src",
	outDir: "./dist",
	themeConfig: {
		// https://vitepress.dev/reference/default-theme-config
		logo: { src: "/logo.svg", width: 24, height: 24 },
		nav: [{ text: "Setup", link: "/setup/" }],
		sidebar: [
			{
				items: [
					// { text: 'Home', link: '/' },
					{ text: "Guide", link: "/guide/" },
					{ text: "Screenshots", link: "/screenshots/" },
					{ text: "Setup Instructions", link: "/setup/" },
					{ text: "Advanced Configuration", link: "/advanced-config/" },
					{ text: "Upgrading", link: "/upgrading/" },
					{ text: "Frequently Asked Questions", link: "/faq/" },
					{ text: "Certbot", link: "/certbot/" },
					{ text: "Third Party", link: "/third-party/" },
				],
			},
		],
		socialLinks: [
			{
				icon: "github",
				link: "https://github.com/innotelinc/npm",
			},
		],
		search: {
			provider: "local",
		},
		footer: {
			message: "Released under the MIT License.",
			copyright: "NPM Edge — Innotel EdgeOps",
		},
	},
});

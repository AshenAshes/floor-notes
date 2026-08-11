interface RenderedImageFixtureOptions {
  source: string;
  label: string;
  kind?: "embed" | "markdown";
  trailingText?: string;
}

export function appendRenderedImageFixture(
  container: HTMLElement,
  options: RenderedImageFixtureOptions
): void {
  const ownerDocument = container.ownerDocument;
  const paragraph = ownerDocument.createElement("p");
  container.appendChild(paragraph);

  const image = ownerDocument.createElement("img");
  image.src = options.kind === "markdown"
    ? options.source
    : `app://local/vault/${options.source}`;
  image.alt = options.label;

  if (options.kind === "markdown") {
    paragraph.appendChild(image);
  } else {
    const embed = ownerDocument.createElement("span");
    embed.className = "internal-embed media-embed image-embed is-loaded";
    embed.setAttribute("src", options.source);
    embed.setAttribute("alt", options.label);
    embed.appendChild(image);
    paragraph.appendChild(embed);
  }

  if (options.trailingText !== undefined) {
    paragraph.appendChild(ownerDocument.createTextNode(options.trailingText));
  }
}

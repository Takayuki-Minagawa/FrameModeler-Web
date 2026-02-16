import { DocumentData } from '../data/DocumentData';
import { Node } from '../data/Node';
import { Beam } from '../data/Beam';
import { Pillar } from '../data/Pillar';
import { Floor } from '../data/Floor';
import { Wall } from '../data/Wall';
import { BearWall } from '../data/BearWall';
import { Document } from '../data/Document';
import { Layer } from '../ui/Layer';

/** データ型 → classname */
function getClassname(data: DocumentData): string {
  if (data instanceof Node) return 'Ebi_FrameModeler.Data.Node';
  if (data instanceof Beam) return 'Ebi_FrameModeler.Data.Beam';
  if (data instanceof Pillar) return 'Ebi_FrameModeler.Data.Pillar';
  if (data instanceof Floor) return 'Ebi_FrameModeler.Data.Floor';
  if (data instanceof Wall) return 'Ebi_FrameModeler.Data.Wall';
  if (data instanceof BearWall) return 'Ebi_FrameModeler.Data.BearWall';
  return 'Unknown';
}

/** DocumentをXML文字列にシリアライズ */
export function serializeXml(): string {
  const doc = Document.instance;
  const xmlDoc = document.implementation.createDocument(null, 'Ebi_FrameModelerDocument', null);
  const root = xmlDoc.documentElement;

  // データ要素を書き出し
  for (const data of doc.allDataList) {
    const elem = xmlDoc.createElement('object');
    elem.setAttribute('classname', getClassname(data));

    const writer = (name: string, value: string) => {
      const child = xmlDoc.createElement(name);
      child.textContent = value;
      elem.appendChild(child);
    };

    data.save(writer);
    root.appendChild(elem);
  }

  // レイヤーを書き出し
  for (const layer of doc.layers) {
    const elem = xmlDoc.createElement('object');
    elem.setAttribute('classname', 'Ebi_FrameModeler.UI.Layer');

    const nameElem = xmlDoc.createElement('Name');
    nameElem.textContent = layer.name;
    elem.appendChild(nameElem);

    const posZElem = xmlDoc.createElement('PosZ');
    posZElem.textContent = String(layer.posZ);
    elem.appendChild(posZElem);

    root.appendChild(elem);
  }

  // XMLを文字列化
  const serializer = new XMLSerializer();
  let xmlStr = serializer.serializeToString(xmlDoc);

  // 読みやすいインデント付与（簡易整形）
  xmlStr = formatXml(xmlStr);
  return xmlStr;
}

/** 簡易XML整形 */
function formatXml(xml: string): string {
  let formatted = '';
  let indent = '';
  const tab = '  ';
  xml.split(/>\s*</).forEach((node) => {
    if (node.match(/^\/\w/)) indent = indent.substring(tab.length);
    formatted += indent + '<' + node + '>\n';
    if (node.match(/^<?\w[^>]*[^/]$/) && !node.startsWith('?')) indent += tab;
  });
  return formatted.substring(1, formatted.length - 2);
}

/** XML文字列をファイルとしてダウンロード */
export function downloadXml(filename: string): void {
  const xmlStr = serializeXml();
  const blob = new Blob([xmlStr], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
